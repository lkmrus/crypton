import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { EnqueueTaskDto } from './dto/enqueue-task.dto';
import { TaskResponseDto } from './dto/task-response.dto';
import { SchedulerStats, TaskStatus } from './types/scheduler.types';

/**
 * Контроллер для управления планировщиком задач через HTTP API
 *
 * @description
 * Предоставляет REST API для:
 * - Добавления задач в очередь
 * - Получения статистики
 * - Управления жизненным циклом планировщика
 */
@Controller('scheduler')
export class SchedulerController {
  private readonly logger = new Logger(SchedulerController.name);

  constructor(private readonly schedulerService: SchedulerService) {}

  /**
   * Добавляет задачу в очередь планировщика
   *
   * @param dto - Данные задачи (ключ, тип, payload, конфигурация retry)
   * @returns Информация о добавленной задаче
   *
   * @description
   * Принимает задачу и добавляет её в очередь выполнения.
   * Если задача с таким ключом уже выполняется, возвращает информацию о дедупликации.
   *
   * @example
   * POST /scheduler/tasks
   * {
   *   "key": "send-email-user-123",
   *   "taskType": "send-notification",
   *   "payload": { "userId": 123, "email": "user@example.com" },
   *   "maxRetries": 3,
   *   "baseDelay": 1000
   * }
   */
  @Post('tasks')
  @HttpCode(HttpStatus.ACCEPTED)
  async enqueueTask(@Body() dto: EnqueueTaskDto): Promise<TaskResponseDto> {
    this.logger.log(`Enqueue task request: key="${dto.key}", type="${dto.taskType}"`);

    try {
      // Создаем mock задачу для демонстрации
      // В реальном приложении здесь должна быть логика маршрутизации задач по типу
      const taskFunction = async () => {
        this.logger.debug(`Executing task: ${dto.taskType} with payload`, dto.payload);
        
        // Симуляция работы задачи
        await new Promise((resolve) => setTimeout(resolve, 100));
        
        return {
          taskType: dto.taskType,
          key: dto.key,
          executedAt: new Date().toISOString(),
          payload: dto.payload,
        };
      };

      // Добавляем задачу в планировщик
      const taskPromise = this.schedulerService.enqueue(
        dto.key,
        taskFunction,
        {
          maxRetries: dto.maxRetries,
          baseDelay: dto.baseDelay,
        },
      );

      // Не ждем завершения задачи, сразу возвращаем ответ
      taskPromise.catch((error) => {
        this.logger.error(`Task failed: key="${dto.key}"`, error);
      });

      return new TaskResponseDto(
        dto.key,
        TaskStatus.PENDING,
        'Task enqueued successfully',
      );
    } catch (error) {
      this.logger.error(`Failed to enqueue task: key="${dto.key}"`, error);
      
      if (error instanceof Error && error.message.includes('shutting down')) {
        return new TaskResponseDto(
          dto.key,
          TaskStatus.CANCELLED,
          'Scheduler is shutting down',
        );
      }

      throw error;
    }
  }

  /**
   * Возвращает текущую статистику планировщика
   *
   * @returns Статистика выполнения задач
   *
   * @description
   * Предоставляет информацию о:
   * - Количестве задач в разных состояниях
   * - Дедупликации и повторах
   * - Успешных и проваленных задачах
   *
   * @example
   * GET /scheduler/stats
   * Response:
   * {
   *   "enqueued": 100,
   *   "running": 5,
   *   "completed": 85,
   *   "deduplicated": 10,
   *   "retried": 15,
   *   "failed": 3,
   *   "cancelled": 2,
   *   "pending": 5
   * }
   */
  @Get('stats')
  getStats(): SchedulerStats {
    return this.schedulerService.getStats();
  }

  /**
   * Инициирует мягкое завершение работы планировщика
   *
   * @returns Статус операции
   *
   * @description
   * Процесс shutdown:
   * 1. Блокирует прием новых задач
   * 2. Отменяет ожидающие задачи
   * 3. Ожидает завершения активных задач
   *
   * @example
   * POST /scheduler/shutdown
   * Response:
   * {
   *   "message": "Shutdown initiated",
   *   "status": "shutting_down"
   * }
   */
  @Post('shutdown')
  @HttpCode(HttpStatus.OK)
  async shutdown(): Promise<{ message: string; status: string }> {
    this.logger.log('Shutdown requested via API');

    // Запускаем shutdown асинхронно
    this.schedulerService.shutdown().then(() => {
      this.logger.log('Shutdown completed via API');
    });

    return {
      message: 'Shutdown initiated',
      status: 'shutting_down',
    };
  }

  /**
   * Проверяет состояние планировщика
   *
   * @returns Статус работы планировщика
   *
   * @description
   * Используется для health checks и мониторинга
   *
   * @example
   * GET /scheduler/health
   * Response:
   * {
   *   "status": "healthy",
   *   "isShuttingDown": false,
   *   "runningTasks": 5,
   *   "pendingTasks": 10
   * }
   */
  @Get('health')
  getHealth(): {
    status: string;
    isShuttingDown: boolean;
    runningTasks: number;
    pendingTasks: number;
  } {
    const stats = this.schedulerService.getStats();
    const isShuttingDown = this.schedulerService.isShutdown();

    return {
      status: isShuttingDown ? 'shutting_down' : 'healthy',
      isShuttingDown,
      runningTasks: stats.running,
      pendingTasks: stats.pending,
    };
  }
}

