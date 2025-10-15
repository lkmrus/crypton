import { SchedulerService } from './scheduler.service';

describe('SchedulerService', () => {
  let service: SchedulerService;

  beforeEach(() => {
    service = new SchedulerService({ concurrencyLimit: 10 });
  });

  afterEach(async () => {
    // Cleanup: shutdown service after each test
    if (!service.isShutdown()) {
      await service.shutdown();
    }
  });

  describe('Базовая функциональность', () => {
    /**
     * Тест: задачи выполняются успешно
     */
    it('должен успешно выполнить простую задачу', async () => {
      const task = jest.fn().mockResolvedValue('success');
      const result = await service.enqueue('test-key-1', task);

      expect(result).toBe('success');
      expect(task).toHaveBeenCalledTimes(1);
    });

    /**
     * Тест: статистика отслеживается корректно
     */
    it('должен корректно обновлять статистику', async () => {
      const task = jest.fn().mockResolvedValue('result');

      const initialStats = service.getStats();
      expect(initialStats.enqueued).toBe(0);
      expect(initialStats.completed).toBe(0);

      await service.enqueue('key-1', task);

      const finalStats = service.getStats();
      expect(finalStats.enqueued).toBe(1);
      expect(finalStats.completed).toBe(1);
      expect(finalStats.running).toBe(0);
    });
  });

  describe('Контроль параллельности', () => {
    /**
     * Тест: соблюдается лимит параллельности
     *
     * Создаем планировщик с лимитом 2, запускаем 5 задач,
     * проверяем что одновременно не более 2 задач выполняется
     */
    it('должен соблюдать лимит параллельности', async () => {
      service = new SchedulerService({ concurrencyLimit: 2 });

      let runningCount = 0;
      let maxConcurrent = 0;

      const createTask = (id: number) => async () => {
        runningCount++;
        maxConcurrent = Math.max(maxConcurrent, runningCount);

        // Симулируем работу
        await new Promise((resolve) => setTimeout(resolve, 50));

        runningCount--;
        return `result-${id}`;
      };

      // Запускаем 5 задач
      const promises = Array.from({ length: 5 }, (_, i) =>
        service.enqueue(`task-${i}`, createTask(i)),
      );

      await Promise.all(promises);

      // Проверяем, что никогда не было больше 2 одновременных задач
      expect(maxConcurrent).toBeLessThanOrEqual(2);
      expect(maxConcurrent).toBeGreaterThan(0);
    });

    /**
     * Тест: задачи в очереди выполняются последовательно после освобождения слотов
     */
    it('должен обрабатывать очередь последовательно', async () => {
      service = new SchedulerService({ concurrencyLimit: 1 });

      const executionOrder: number[] = [];

      const createTask = (id: number) => async () => {
        executionOrder.push(id);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return id;
      };

      // Запускаем 3 задачи последовательно (лимит = 1)
      const promises = [
        service.enqueue('task-1', createTask(1)),
        service.enqueue('task-2', createTask(2)),
        service.enqueue('task-3', createTask(3)),
      ];

      await Promise.all(promises);

      // Проверяем, что задачи выполнились в порядке добавления
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    /**
     * Тест: статистика running и pending корректна
     */
    it('должен корректно отслеживать running и pending задачи', async () => {
      service = new SchedulerService({ concurrencyLimit: 1 });

      let resolve1: () => void;
      const task1Promise = new Promise<void>((res) => {
        resolve1 = res;
      });

      // Запускаем первую задачу (будет выполняться)
      const promise1 = service.enqueue('task-1', async () => {
        await task1Promise;
        return 'result-1';
      });

      // Даем время на запуск первой задачи
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Проверяем, что 1 задача running
      let stats = service.getStats();
      expect(stats.running).toBe(1);
      expect(stats.pending).toBe(0);

      // Добавляем вторую задачу (будет в очереди)
      const promise2 = service.enqueue('task-2', () =>
        Promise.resolve('result-2'),
      );

      // Даем время на обработку
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Проверяем, что 1 running, 1 pending
      stats = service.getStats();
      expect(stats.running).toBe(1);
      expect(stats.pending).toBe(1);

      // Завершаем первую задачу
      resolve1!();
      await promise1;
      await promise2;

      // Проверяем финальную статистику
      stats = service.getStats();
      expect(stats.running).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.completed).toBe(2);
    });
  });

  describe('Дедупликация задач', () => {
    /**
     * Тест: конкурентные запросы с одним ключом получают один результат
     *
     * Запускаем 3 задачи с одним ключом параллельно,
     * проверяем что функция вызвана только 1 раз
     */
    it('должен дедуплицировать задачи по ключу', async () => {
      const task = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'shared-result';
      });

      // Запускаем 3 задачи с одним ключом одновременно
      const promises = [
        service.enqueue('same-key', task),
        service.enqueue('same-key', task),
        service.enqueue('same-key', task),
      ];

      const results = await Promise.all(promises);

      // Все должны получить один результат
      expect(results).toEqual([
        'shared-result',
        'shared-result',
        'shared-result',
      ]);

      // Функция должна быть вызвана только 1 раз
      expect(task).toHaveBeenCalledTimes(1);

      // Статистика должна показать 2 дедупликации
      const stats = service.getStats();
      expect(stats.deduplicated).toBe(2);
      expect(stats.enqueued).toBe(1);
    });

    /**
     * Тест: задачи с разными ключами не дедуплицируются
     */
    it('должен выполнять задачи с разными ключами отдельно', async () => {
      const task = jest.fn().mockResolvedValue('result');

      await Promise.all([
        service.enqueue('key-1', task),
        service.enqueue('key-2', task),
        service.enqueue('key-3', task),
      ]);

      // Функция должна быть вызвана 3 раза
      expect(task).toHaveBeenCalledTimes(3);

      const stats = service.getStats();
      expect(stats.deduplicated).toBe(0);
      expect(stats.enqueued).toBe(3);
    });

    /**
     * Тест: после завершения задачи ключ освобождается
     */
    it('должен разрешать повторное использование ключа после завершения', async () => {
      const task = jest.fn().mockResolvedValue('result');

      // Первое выполнение
      await service.enqueue('reusable-key', task);
      expect(task).toHaveBeenCalledTimes(1);

      // Второе выполнение с тем же ключом
      await service.enqueue('reusable-key', task);
      expect(task).toHaveBeenCalledTimes(2);

      const stats = service.getStats();
      expect(stats.deduplicated).toBe(0);
      expect(stats.enqueued).toBe(2);
    });
  });

  describe('Retry механизм', () => {
    /**
     * Тест: задача повторяется при сбое
     */
    it('должен повторять задачу при ошибках', async () => {
      let attempts = 0;
      const task = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Task failed'));
        }
        return Promise.resolve('success');
      });

      const result = await service.enqueue('retry-key', task, {
        maxRetries: 3,
        baseDelay: 10,
      });

      expect(result).toBe('success');
      expect(task).toHaveBeenCalledTimes(3);

      const stats = service.getStats();
      expect(stats.retried).toBe(2); // 2 retry после первой попытки
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(0);
    });

    /**
     * Тест: задача проваливается после исчерпания попыток
     */
    it('должен провалить задачу после исчерпания попыток', async () => {
      const task = jest.fn().mockRejectedValue(new Error('Permanent failure'));

      await expect(
        service.enqueue('failing-key', task, {
          maxRetries: 2,
          baseDelay: 10,
        }),
      ).rejects.toThrow('Permanent failure');

      // Должно быть 3 попытки (1 + 2 retry)
      expect(task).toHaveBeenCalledTimes(3);

      const stats = service.getStats();
      expect(stats.retried).toBe(2);
      expect(stats.failed).toBe(1);
      expect(stats.completed).toBe(0);
    });

    /**
     * Тест: задержки растут экспоненциально (с fake timers)
     */
    it('должен использовать экспоненциальную задержку', async () => {
      jest.useFakeTimers();

      let attempts = 0;
      const attemptTimestamps: number[] = [];

      const task = jest.fn().mockImplementation(() => {
        attempts++;
        attemptTimestamps.push(Date.now());

        if (attempts < 4) {
          return Promise.reject(new Error('Retry needed'));
        }
        return Promise.resolve('success');
      });

      const promise = service.enqueue('delay-test', task, {
        maxRetries: 3,
        baseDelay: 1000,
        jitter: 0, // Отключаем jitter для предсказуемости
      });

      // Первая попытка выполняется сразу
      await jest.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);

      // Вторая попытка после ~1000ms (2^0 * 1000)
      await jest.advanceTimersByTimeAsync(1000);
      expect(attempts).toBe(2);

      // Третья попытка после ~2000ms (2^1 * 1000)
      await jest.advanceTimersByTimeAsync(2000);
      expect(attempts).toBe(3);

      // Четвертая попытка после ~4000ms (2^2 * 1000)
      await jest.advanceTimersByTimeAsync(4000);
      expect(attempts).toBe(4);

      await promise;
      expect(await promise).toBe('success');

      jest.useRealTimers();
    });
  });

  describe('Graceful Shutdown', () => {
    /**
     * Тест: активные задачи завершаются, ожидающие отменяются
     */
    it('должен дождаться активных задач и отменить ожидающие', async () => {
      service = new SchedulerService({ concurrencyLimit: 1 });

      let task1Completed = false;

      const task1 = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        task1Completed = true;
        return 'task1-result';
      };

      const task2 = () => Promise.resolve('task2-result');

      const promise1 = service.enqueue('task-1', task1);

      await new Promise((resolve) => setTimeout(resolve, 10));

      void service.enqueue('task-2', task2);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const shutdownPromise = service.shutdown();

      await expect(promise1).resolves.toBe('task1-result');
      expect(task1Completed).toBe(true);

      await shutdownPromise;

      const stats = service.getStats();
      expect(stats.cancelled).toBeGreaterThan(0);
    });

    /**
     * Тест: новые задачи отклоняются после shutdown
     */
    it('должен отклонять новые задачи после shutdown', async () => {
      await service.shutdown();

      const task = jest.fn().mockResolvedValue('result');

      await expect(service.enqueue('new-task', task)).rejects.toThrow(
        'Scheduler is shutting down',
      );

      expect(task).not.toHaveBeenCalled();

      const stats = service.getStats();
      expect(stats.cancelled).toBe(1);
    });

    /**
     * Тест: isShutdown флаг работает корректно
     */
    it('должен корректно устанавливать флаг isShutdown', () => {
      expect(service.isShutdown()).toBe(false);

      void service.shutdown();

      expect(service.isShutdown()).toBe(true);
    });

    /**
     * Тест: shutdown с пустой очередью завершается немедленно
     */
    it('должен быстро завершать shutdown если нет задач', async () => {
      const startTime = Date.now();
      await service.shutdown();
      const endTime = Date.now();

      const duration = endTime - startTime;
      expect(duration).toBeLessThan(200); // Должно завершиться быстро
      expect(service.isShutdown()).toBe(true);
    });
  });

  describe('Статистика', () => {
    /**
     * Тест: все счетчики статистики работают корректно
     */
    it('должен корректно собирать комплексную статистику', async () => {
      service = new SchedulerService({ concurrencyLimit: 2 });

      const successTask = jest.fn().mockResolvedValue('success');
      const failTask = jest.fn().mockRejectedValue(new Error('fail'));

      let retryAttempt = 0;
      const retryTask = jest.fn().mockImplementation(() => {
        retryAttempt++;
        if (retryAttempt < 2) {
          return Promise.reject(new Error('retry'));
        }
        return Promise.resolve('retry-success');
      });

      // Успешная задача
      await service.enqueue('success-1', successTask);

      // Дедупликация (2 задачи с одним ключом)
      await Promise.all([
        service.enqueue('dup-key', successTask),
        service.enqueue('dup-key', successTask),
      ]);

      // Задача с retry
      await service.enqueue('retry-key', retryTask, {
        maxRetries: 2,
        baseDelay: 10,
      });

      // Проваленная задача
      await service
        .enqueue('fail-key', failTask, { maxRetries: 1, baseDelay: 10 })
        .catch(() => {});

      const stats = service.getStats();

      expect(stats.enqueued).toBe(4); // success-1, dup-key, retry-key, fail-key
      expect(stats.deduplicated).toBe(1); // один дубликат dup-key
      expect(stats.completed).toBe(3); // success-1, dup-key, retry-key
      expect(stats.retried).toBeGreaterThanOrEqual(2); // retry-key: 1, fail-key: 1
      expect(stats.failed).toBe(1); // fail-key
      expect(stats.running).toBe(0);
      expect(stats.pending).toBe(0);
    });

    /**
     * Тест: getStats возвращает копию статистики
     */
    it('должен возвращать копию статистики', () => {
      const stats1 = service.getStats();
      const stats2 = service.getStats();

      expect(stats1).toEqual(stats2);
      expect(stats1).not.toBe(stats2); // Разные объекты
    });
  });

  describe('Обработка ошибок', () => {
    /**
     * Тест: ошибки в задачах не ломают планировщик
     */
    it('должен продолжать работу после ошибок в задачах', async () => {
      const failTask = jest.fn().mockRejectedValue(new Error('error'));
      const successTask = jest.fn().mockResolvedValue('success');

      await service
        .enqueue('fail', failTask, { maxRetries: 0 })
        .catch(() => {});
      await service.enqueue('success', successTask);

      expect(failTask).toHaveBeenCalled();
      expect(successTask).toHaveBeenCalled();

      const stats = service.getStats();
      expect(stats.failed).toBe(1);
      expect(stats.completed).toBe(1);
    });

    /**
     * Тест: синхронные ошибки обрабатываются корректно
     */
    it('должен обрабатывать синхронные ошибки', async () => {
      const task = jest
        .fn()
        .mockImplementation(() =>
          Promise.reject(new Error('Synchronous error')),
        );

      await expect(
        service.enqueue('sync-error', task, { maxRetries: 1, baseDelay: 10 }),
      ).rejects.toThrow('Synchronous error');

      // Должно быть 2 попытки
      expect(task).toHaveBeenCalledTimes(2);

      const stats = service.getStats();
      expect(stats.failed).toBe(1);
    });
  });
});
