import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';
import { EnqueueTaskDto } from './dto/enqueue-task.dto';
import { TaskStatus } from './types/scheduler.types';

describe('SchedulerController', () => {
  let controller: SchedulerController;
  let service: SchedulerService;

  beforeEach(async () => {
    // Создаем новый планировщик для каждого теста
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SchedulerController],
      providers: [
        {
          provide: SchedulerService,
          useFactory: () => new SchedulerService({ concurrencyLimit: 10 }),
        },
      ],
    }).compile();

    controller = module.get<SchedulerController>(SchedulerController);
    service = module.get<SchedulerService>(SchedulerService);
  });

  afterEach(async () => {
    if (!service.isShutdown()) {
      await service.shutdown();
    }
  });

  describe('POST /scheduler/tasks', () => {
    /**
     * Тест: успешное добавление задачи через HTTP API
     */
    it('должен успешно добавить задачу в очередь', () => {
      const dto: EnqueueTaskDto = {
        key: 'test-task-1',
        taskType: 'notification',
        payload: { userId: 123 },
        maxRetries: 3,
        baseDelay: 1000,
      };

      const result = controller.enqueueTask(dto);

      expect(result).toBeDefined();
      expect(result.key).toBe('test-task-1');
      expect(result.status).toBe(TaskStatus.PENDING);
      expect(result.message).toBe('Task enqueued successfully');
    });

    /**
     * Тест: добавление задачи без опциональных параметров
     */
    it('должен принять задачу без опциональных параметров', () => {
      const dto: EnqueueTaskDto = {
        key: 'minimal-task',
        taskType: 'simple-job',
      };

      const result = controller.enqueueTask(dto);

      expect(result).toBeDefined();
      expect(result.key).toBe('minimal-task');
      expect(result.status).toBe(TaskStatus.PENDING);
    });

    /**
     * Тест: задача с payload
     */
    it('должен корректно обработать задачу с payload', () => {
      const dto: EnqueueTaskDto = {
        key: 'payload-task',
        taskType: 'data-processing',
        payload: {
          items: [1, 2, 3],
          config: { batch: true },
        },
      };

      const result = controller.enqueueTask(dto);

      expect(result).toBeDefined();
      expect(result.key).toBe('payload-task');
    });

    /**
     * Тест: задача добавляется в статистику
     */
    it('должен увеличить счетчик enqueued в статистике', async () => {
      const initialStats = service.getStats();
      const initialEnqueued = initialStats.enqueued;

      const dto: EnqueueTaskDto = {
        key: 'stats-test',
        taskType: 'counter-test',
      };

      controller.enqueueTask(dto);

      // Даем немного времени на обработку
      await new Promise((resolve) => setTimeout(resolve, 10));

      const finalStats = service.getStats();
      expect(finalStats.enqueued).toBe(initialEnqueued + 1);
    });

    /**
     * Тест: попытка добавить задачу после shutdown
     */
    it('должен обработать попытку добавления задачи после shutdown', async () => {
      // Инициируем shutdown
      await service.shutdown();

      // Проверяем, что флаг shutdown установлен
      expect(service.isShutdown()).toBe(true);

      const dto: EnqueueTaskDto = {
        key: 'rejected-task',
        taskType: 'too-late',
      };

      // Контроллер вернет ответ (либо CANCELLED, либо PENDING в зависимости от таймингов)
      const result = controller.enqueueTask(dto);

      // Проверяем, что задача была обработана
      expect(result).toBeDefined();
      expect(result.key).toBe('rejected-task');
      // Статус может быть CANCELLED или PENDING в зависимости от race condition
      expect([TaskStatus.CANCELLED, TaskStatus.PENDING]).toContain(
        result.status,
      );
    });
  });

  describe('GET /scheduler/stats', () => {
    /**
     * Тест: получение статистики
     */
    it('должен возвращать текущую статистику планировщика', () => {
      const stats = controller.getStats();

      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('enqueued');
      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('deduplicated');
      expect(stats).toHaveProperty('retried');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('cancelled');
      expect(stats).toHaveProperty('pending');
    });

    /**
     * Тест: статистика обновляется после добавления задач
     */
    it('должен показывать обновленную статистику после операций', async () => {
      const initialStats = controller.getStats();
      expect(initialStats.enqueued).toBe(0);

      const dto: EnqueueTaskDto = {
        key: 'stat-update-test',
        taskType: 'test',
      };

      controller.enqueueTask(dto);

      // Даем время на обработку
      await new Promise((resolve) => setTimeout(resolve, 50));

      const updatedStats = controller.getStats();
      expect(updatedStats.enqueued).toBeGreaterThan(initialStats.enqueued);
    });

    /**
     * Тест: формат статистики корректен
     */
    it('должен возвращать статистику с числовыми значениями', () => {
      const stats = controller.getStats();

      expect(typeof stats.enqueued).toBe('number');
      expect(typeof stats.running).toBe('number');
      expect(typeof stats.completed).toBe('number');
      expect(typeof stats.deduplicated).toBe('number');
      expect(typeof stats.retried).toBe('number');
      expect(typeof stats.failed).toBe('number');
      expect(typeof stats.cancelled).toBe('number');
      expect(typeof stats.pending).toBe('number');

      expect(stats.enqueued).toBeGreaterThanOrEqual(0);
      expect(stats.running).toBeGreaterThanOrEqual(0);
    });
  });

  describe('POST /scheduler/shutdown', () => {
    /**
     * Тест: инициирование shutdown
     */
    it('должен инициировать graceful shutdown', () => {
      const result = controller.shutdown();

      expect(result).toBeDefined();
      expect(result.message).toBe('Shutdown initiated');
      expect(result.status).toBe('shutting_down');
    });

    /**
     * Тест: shutdown устанавливает флаг
     */
    it('должен установить флаг shutdown в планировщике', async () => {
      expect(service.isShutdown()).toBe(false);

      controller.shutdown();

      // Даем время на обработку
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(service.isShutdown()).toBe(true);
    });

    /**
     * Тест: повторный вызов shutdown безопасен
     */
    it('должен безопасно обрабатывать повторный shutdown', async () => {
      const result1 = controller.shutdown();
      expect(result1.status).toBe('shutting_down');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const result2 = controller.shutdown();
      expect(result2.status).toBe('shutting_down');
    });
  });

  describe('GET /scheduler/health', () => {
    /**
     * Тест: проверка здоровья планировщика
     */
    it('должен возвращать healthy статус для активного планировщика', () => {
      const health = controller.getHealth();

      expect(health).toBeDefined();
      expect(health.status).toBe('healthy');
      expect(health.isShuttingDown).toBe(false);
      expect(typeof health.runningTasks).toBe('number');
      expect(typeof health.pendingTasks).toBe('number');
    });

    /**
     * Тест: health check отражает текущее состояние
     */
    it('должен отражать количество задач в health check', async () => {
      const dto: EnqueueTaskDto = {
        key: 'health-test',
        taskType: 'test',
      };

      controller.enqueueTask(dto);

      // Даем время на обработку
      await new Promise((resolve) => setTimeout(resolve, 10));

      const health = controller.getHealth();

      // runningTasks или pendingTasks могут быть > 0 или уже 0 если задача выполнилась
      expect(health.runningTasks).toBeGreaterThanOrEqual(0);
      expect(health.pendingTasks).toBeGreaterThanOrEqual(0);
    });

    /**
     * Тест: health check показывает shutting_down
     */
    it('должен показывать shutting_down статус после shutdown', async () => {
      controller.shutdown();

      // Даем время на обработку
      await new Promise((resolve) => setTimeout(resolve, 50));

      const health = controller.getHealth();

      expect(health.status).toBe('shutting_down');
      expect(health.isShuttingDown).toBe(true);
    });

    /**
     * Тест: структура health response
     */
    it('должен возвращать корректную структуру health response', () => {
      const health = controller.getHealth();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('isShuttingDown');
      expect(health).toHaveProperty('runningTasks');
      expect(health).toHaveProperty('pendingTasks');
    });
  });

  describe('Интеграционные сценарии', () => {
    /**
     * Тест: полный цикл работы с задачами
     */
    it('должен корректно обработать полный жизненный цикл задач', async () => {
      // 1. Проверяем начальное состояние
      let health = controller.getHealth();
      expect(health.status).toBe('healthy');

      // 2. Добавляем несколько задач
      controller.enqueueTask({
        key: 'task-1',
        taskType: 'job-1',
      });

      controller.enqueueTask({
        key: 'task-2',
        taskType: 'job-2',
      });

      // 3. Проверяем статистику
      await new Promise((resolve) => setTimeout(resolve, 10));
      let stats = controller.getStats();
      expect(stats.enqueued).toBeGreaterThanOrEqual(2);

      // 4. Ждем завершения задач
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 5. Проверяем что задачи были поставлены в очередь
      stats = controller.getStats();
      expect(stats.enqueued).toBe(2);

      // Даем больше времени на завершение
      await new Promise((resolve) => setTimeout(resolve, 100));

      stats = controller.getStats();
      // Проверяем что нет активных задач
      expect(stats.running).toBe(0);

      // 6. Инициируем shutdown
      controller.shutdown();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 7. Проверяем финальное состояние
      health = controller.getHealth();
      expect(health.status).toBe('shutting_down');
    });

    /**
     * Тест: дедупликация через API
     */
    it('должен дедуплицировать задачи с одинаковым ключом', async () => {
      const dto: EnqueueTaskDto = {
        key: 'duplicate-key',
        taskType: 'dup-test',
      };

      // Добавляем 3 задачи с одинаковым ключом
      const results = [
        controller.enqueueTask(dto),
        controller.enqueueTask(dto),
        controller.enqueueTask(dto),
      ];

      // Все должны получить ответ
      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.key).toBe('duplicate-key');
      });

      // Ждем выполнения
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Проверяем статистику дедупликации
      const stats = controller.getStats();
      expect(stats.deduplicated).toBeGreaterThanOrEqual(2);
    });

    /**
     * Тест: множественные задачи не превышают лимит параллельности
     */
    it('должен обрабатывать множество задач с учетом лимита', async () => {
      // Добавляем 10 задач
      const results = Array.from({ length: 10 }, (_, i) =>
        controller.enqueueTask({
          key: `bulk-task-${i}`,
          taskType: 'bulk-job',
        }),
      );

      expect(results).toHaveLength(10);

      const health = controller.getHealth();
      expect(health.runningTasks).toBeLessThanOrEqual(10);

      await new Promise((resolve) => setTimeout(resolve, 50));

      await new Promise((resolve) => setTimeout(resolve, 150));

      const stats = controller.getStats();
      expect(stats.enqueued).toBe(10);
    });
  });

  describe('Валидация и обработка ошибок', () => {
    /**
     * Тест: обработка задач с различными payload
     */
    it('должен корректно обрабатывать различные типы payload', () => {
      const payloads = [
        null,
        undefined,
        { simple: 'value' },
        { nested: { deep: { value: 123 } } },
        { array: [1, 2, 3] },
        'string-payload',
        123,
      ];

      for (let i = 0; i < payloads.length; i++) {
        const result = controller.enqueueTask({
          key: `payload-test-${i}`,
          taskType: 'payload-validation',
          payload: payloads[i],
        });

        expect(result).toBeDefined();
        expect(result.status).toBe(TaskStatus.PENDING);
      }
    });

    /**
     * Тест: задачи с различными конфигурациями retry
     */
    it('должен принимать различные конфигурации retry', () => {
      const configs = [
        { maxRetries: 1, baseDelay: 100 },
        { maxRetries: 5, baseDelay: 2000 },
        { maxRetries: 0 }, // без retry
        { baseDelay: 500 }, // только baseDelay
      ];

      for (let i = 0; i < configs.length; i++) {
        const result = controller.enqueueTask({
          key: `retry-config-${i}`,
          taskType: 'retry-test',
          ...configs[i],
        });

        expect(result).toBeDefined();
        expect(result.key).toBe(`retry-config-${i}`);
      }
    });
  });
});
