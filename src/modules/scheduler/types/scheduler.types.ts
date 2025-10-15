/**
 * Функция задачи, которая возвращает Promise с результатом типа T
 */
export type TaskFunction<T> = () => Promise<T>;

/**
 * Конфигурация для выполнения задачи
 */
export interface TaskConfig {
  /** Максимальное количество попыток выполнения (по умолчанию 3) */
  maxRetries?: number;
  /** Базовая задержка между попытками в миллисекундах (по умолчанию 1000) */
  baseDelay?: number;
  /** Процент jitter для randomization задержки (по умолчанию 0.2 = 20%) */
  jitter?: number;
}

/**
 * Конфигурация планировщика
 */
export interface SchedulerConfig {
  /** Максимальное количество одновременно выполняемых задач */
  concurrencyLimit: number;
}

/**
 * Статусы выполнения задачи
 */
export enum TaskStatus {
  /** Задача в очереди ожидания */
  PENDING = 'PENDING',
  /** Задача выполняется */
  RUNNING = 'RUNNING',
  /** Задача успешно завершена */
  COMPLETED = 'COMPLETED',
  /** Задача завершилась с ошибкой после всех попыток */
  FAILED = 'FAILED',
  /** Задача отменена (например, при shutdown) */
  CANCELLED = 'CANCELLED',
}

/**
 * Результат выполнения задачи
 */
export interface TaskResult<T> {
  /** Статус выполнения */
  status: TaskStatus;
  /** Результат выполнения (если успешно) */
  data?: T;
  /** Ошибка (если неудачно) */
  error?: Error;
  /** Количество попыток выполнения */
  attempts: number;
}

/**
 * Статистика планировщика
 */
export interface SchedulerStats {
  /** Общее количество добавленных задач */
  enqueued: number;
  /** Количество задач в процессе выполнения */
  running: number;
  /** Количество успешно завершенных задач */
  completed: number;
  /** Количество задач, обработанных через дедупликацию */
  deduplicated: number;
  /** Количество повторных попыток выполнения */
  retried: number;
  /** Количество задач, завершившихся с ошибкой */
  failed: number;
  /** Количество отмененных задач */
  cancelled: number;
  /** Количество задач в очереди ожидания */
  pending: number;
}

/**
 * Внутренний тип для хранения задачи в очереди
 */
export interface QueuedTask<T> {
  /** Уникальный ключ задачи */
  key: string;
  /** Функция задачи */
  task: TaskFunction<T>;
  /** Конфигурация задачи */
  config: Required<TaskConfig>;
  /** Promise resolve callback */
  resolve: (value: T) => void;
  /** Promise reject callback */
  reject: (error: Error) => void;
}
