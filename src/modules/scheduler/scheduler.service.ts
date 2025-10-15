import { Injectable, Logger } from '@nestjs/common';
import {
  SchedulerConfig,
  SchedulerStats,
  TaskConfig,
  TaskFunction,
  TaskStatus,
  QueuedTask,
} from './types/scheduler.types';

/**
 * Сервис планировщика задач с ограничением параллельности, дедупликацией и retry логикой
 *
 * @description
 * Основные возможности:
 * - Контроль параллельности выполнения задач
 * - Дедупликация задач по ключу (конкурентные запросы получают один результат)
 * - Автоматические повторы при сбоях с экспоненциальной задержкой
 * - Graceful shutdown с ожиданием активных задач
 * - Сбор статистики выполнения
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  /** Конфигурация планировщика */
  private readonly config: SchedulerConfig;

  /** Счетчик текущих выполняющихся задач */
  private runningTasksCount = 0;

  /** Очередь ожидающих задач */
  private pendingQueue: Array<() => void> = [];

  /** Map для отслеживания выполняющихся задач по ключу (для дедупликации) */
  private runningTasks: Map<string, Promise<any>> = new Map();

  /** Флаг мягкого завершения работы */
  private isShuttingDown = false;

  /** Статистика планировщика */
  private stats: SchedulerStats = {
    enqueued: 0,
    running: 0,
    completed: 0,
    deduplicated: 0,
    retried: 0,
    failed: 0,
    cancelled: 0,
    pending: 0,
  };

  /** Конфигурация задачи по умолчанию */
  private readonly defaultTaskConfig: Required<TaskConfig> = {
    maxRetries: 3,
    baseDelay: 1000,
    jitter: 0.2,
  };

  /**
   * Создает экземпляр планировщика
   *
   * @param config - Конфигурация планировщика с лимитом параллельности
   */
  constructor(config?: SchedulerConfig) {
    this.config = config || { concurrencyLimit: 10 };
    this.logger.log(
      `Scheduler initialized with concurrency limit: ${this.config.concurrencyLimit}`,
    );
  }

  /**
   * Добавляет задачу в очередь выполнения
   *
   * @template T - Тип результата задачи
   * @param key - Уникальный ключ задачи для дедупликации
   * @param task - Функция задачи, возвращающая Promise
   * @param config - Опциональная конфигурация задачи (retry параметры)
   * @returns Promise с результатом выполнения задачи
   * @throws Error если планировщик находится в процессе shutdown
   *
   * @example
   * ```typescript
   * const result = await scheduler.enqueue(
   *   'fetch-user-123',
   *   () => fetchUser(123),
   *   { maxRetries: 5, baseDelay: 2000 }
   * );
   * ```
   */
  async enqueue<T>(
    key: string,
    task: TaskFunction<T>,
    config?: TaskConfig,
  ): Promise<T> {
    // Проверка на shutdown
    if (this.isShuttingDown) {
      this.stats.cancelled++;
      throw new Error('Scheduler is shutting down, cannot accept new tasks');
    }

    // Дедупликация: если задача с таким ключом уже выполняется
    const existingTask = this.runningTasks.get(key);
    if (existingTask) {
      this.stats.deduplicated++;
      this.logger.debug(`Task deduplication: key="${key}"`);
      return existingTask;
    }

    // Увеличиваем счетчик поставленных в очередь задач
    this.stats.enqueued++;

    // Мержим конфигурацию с дефолтной
    const taskConfig: Required<TaskConfig> = {
      ...this.defaultTaskConfig,
      ...config,
    };

    // Создаем Promise для задачи
    const taskPromise = new Promise<T>((resolve, reject) => {
      const queuedTask: QueuedTask<T> = {
        key,
        task,
        config: taskConfig,
        resolve,
        reject,
      };

      // Добавляем задачу в очередь
      this.pendingQueue.push(() => this.executeTask(queuedTask));
      this.stats.pending = this.pendingQueue.length;

      // Запускаем обработку очереди
      this.processQueue();
    });

    // Регистрируем задачу в Map для дедупликации
    this.runningTasks.set(key, taskPromise);

    // После завершения удаляем из Map
    taskPromise
      .finally(() => {
        this.runningTasks.delete(key);
      })
      .catch(() => {
        // Ignore errors here, they are handled in executeTask
      });

    return taskPromise;
  }

  /**
   * Обрабатывает очередь задач с учетом лимита параллельности
   *
   * @description
   * Запускает задачи из очереди, если количество выполняющихся задач
   * меньше лимита параллельности
   */
  private processQueue(): void {
    // Запускаем задачи пока есть место и очередь не пуста
    while (
      this.runningTasksCount < this.config.concurrencyLimit &&
      this.pendingQueue.length > 0
    ) {
      const taskExecutor = this.pendingQueue.shift();
      if (taskExecutor) {
        this.stats.pending = this.pendingQueue.length;
        taskExecutor();
      }
    }
  }

  /**
   * Выполняет задачу с retry логикой
   *
   * @template T - Тип результата задачи
   * @param queuedTask - Задача из очереди со всеми параметрами
   *
   * @description
   * Управляет выполнением задачи: увеличивает счетчики, вызывает retry логику,
   * обрабатывает успех/ошибку, освобождает слот для следующей задачи
   */
  private async executeTask<T>(queuedTask: QueuedTask<T>): Promise<void> {
    const { key, task, config, resolve, reject } = queuedTask;

    // Проверяем shutdown перед выполнением
    if (this.isShuttingDown) {
      this.stats.cancelled++;
      reject(new Error('Task cancelled due to shutdown'));
      return;
    }

    // Увеличиваем счетчик выполняющихся задач
    this.runningTasksCount++;
    this.stats.running = this.runningTasksCount;

    this.logger.debug(
      `Task started: key="${key}", running=${this.runningTasksCount}/${this.config.concurrencyLimit}`,
    );

    try {
      // Выполняем задачу с retry логикой
      const result = await this.executeWithRetry(task, config, key);

      // Успешное выполнение
      this.stats.completed++;
      this.logger.debug(`Task completed: key="${key}"`);
      resolve(result);
    } catch (error) {
      // Задача провалилась после всех попыток
      this.stats.failed++;
      this.logger.error(`Task failed: key="${key}"`, error);
      reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      // Освобождаем слот
      this.runningTasksCount--;
      this.stats.running = this.runningTasksCount;

      // Запускаем следующую задачу из очереди
      this.processQueue();
    }
  }

  /**
   * Выполняет задачу с повторными попытками при сбоях
   *
   * @template T - Тип результата задачи
   * @param task - Функция задачи
   * @param config - Конфигурация с параметрами retry
   * @param key - Ключ задачи для логирования
   * @returns Результат успешного выполнения задачи
   * @throws Error после исчерпания всех попыток
   *
   * @description
   * Пытается выполнить задачу, при неудаче делает паузу с экспоненциальной задержкой
   * и повторяет попытку. Задержка увеличивается с каждой попыткой.
   */
  private async executeWithRetry<T>(
    task: TaskFunction<T>,
    config: Required<TaskConfig>,
    key: string,
  ): Promise<T> {
    let lastError: Error | undefined;
    const maxAttempts = config.maxRetries + 1; // +1 для первой попытки

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Выполняем задачу
        const result = await task();
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Если это последняя попытка, выбрасываем ошибку
        if (attempt === maxAttempts) {
          this.logger.warn(
            `Task exhausted all retries: key="${key}", attempts=${attempt}`,
          );
          throw lastError;
        }

        // Увеличиваем счетчик retry
        this.stats.retried++;

        // Вычисляем задержку перед следующей попыткой
        const delay = this.calculateRetryDelay(attempt - 1, config);

        this.logger.debug(
          `Task retry scheduled: key="${key}", attempt=${attempt}/${maxAttempts}, delay=${delay}ms`,
        );

        // Ждем перед следующей попыткой
        await this.sleep(delay);
      }
    }

    // Этот код никогда не должен выполниться, но TypeScript требует
    throw lastError || new Error('Unknown error');
  }

  /**
   * Вычисляет задержку перед повторной попыткой с экспоненциальным ростом и jitter
   *
   * @param attempt - Номер попытки (начиная с 0)
   * @param config - Конфигурация с baseDelay и jitter
   * @returns Задержка в миллисекундах
   *
   * @description
   * Формула: delay = baseDelay * (2 ^ attempt) ± jitter
   * Jitter добавляет случайность для предотвращения "thundering herd"
   *
   * @example
   * ```typescript
   * // С baseDelay=1000, jitter=0.2
   * calculateRetryDelay(0, config) // ~1000ms ± 20%
   * calculateRetryDelay(1, config) // ~2000ms ± 20%
   * calculateRetryDelay(2, config) // ~4000ms ± 20%
   * ```
   */
  private calculateRetryDelay(
    attempt: number,
    config: Required<TaskConfig>,
  ): number {
    const { baseDelay, jitter } = config;

    // Экспоненциальная задержка: baseDelay * 2^attempt
    const exponentialDelay = baseDelay * Math.pow(2, attempt);

    // Добавляем jitter (случайное отклонение ±jitter%)
    const jitterAmount = exponentialDelay * jitter;
    const randomJitter = (Math.random() * 2 - 1) * jitterAmount; // от -jitter до +jitter

    const finalDelay = Math.max(0, exponentialDelay + randomJitter);

    return Math.round(finalDelay);
  }

  /**
   * Утилита для создания задержки
   *
   * @param ms - Количество миллисекунд для ожидания
   * @returns Promise, который резолвится через указанное время
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Инициирует мягкое завершение работы планировщика
   *
   * @returns Promise, который резолвится когда все активные задачи завершены
   *
   * @description
   * Процесс shutdown:
   * 1. Устанавливает флаг isShuttingDown (новые задачи будут отклонены)
   * 2. Отменяет все ожидающие задачи в очереди
   * 3. Ожидает завершения всех активных задач
   *
   * @example
   * ```typescript
   * await scheduler.shutdown();
   * console.log('Scheduler gracefully stopped');
   * ```
   */
  async shutdown(): Promise<void> {
    this.logger.log('Shutdown initiated...');
    this.isShuttingDown = true;

    // Отменяем все ожидающие задачи
    const pendingCount = this.pendingQueue.length;
    this.pendingQueue = [];
    this.stats.cancelled += pendingCount;
    this.stats.pending = 0;

    if (pendingCount > 0) {
      this.logger.log(`Cancelled ${pendingCount} pending tasks`);
    }

    // Ожидаем завершения активных задач
    if (this.runningTasksCount > 0) {
      this.logger.log(
        `Waiting for ${this.runningTasksCount} running tasks to complete...`,
      );

      // Ждем пока все активные задачи завершатся
      while (this.runningTasksCount > 0) {
        await this.sleep(100);
      }
    }

    this.logger.log('Shutdown completed');
  }

  /**
   * Возвращает текущую статистику планировщика
   *
   * @returns Объект со статистикой выполнения задач
   *
   * @description
   * Включает информацию о:
   * - Количестве задач в разных состояниях
   * - Дедупликации и retry
   * - Успешных и проваленных задачах
   */
  getStats(): SchedulerStats {
    return { ...this.stats };
  }

  /**
   * Проверяет, находится ли планировщик в процессе shutdown
   *
   * @returns true если shutdown инициирован
   */
  isShutdown(): boolean {
    return this.isShuttingDown;
  }
}

