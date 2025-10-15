import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { SchedulerController } from './scheduler.controller';

/**
 * Модуль планировщика задач
 *
 * @description
 * Предоставляет функциональность планирования и выполнения задач с:
 * - Ограничением параллельности
 * - Дедупликацией по ключу
 * - Retry логикой с экспоненциальной задержкой
 * - Graceful shutdown
 * - HTTP API для управления
 *
 * @example
 * // Импорт в другой модуль
 * ```typescript
 * @Module({
 *   imports: [SchedulerModule],
 * })
 * export class SomeModule {}
 * ```
 *
 * @example
 * // Использование сервиса
 * ```typescript
 * constructor(private schedulerService: SchedulerService) {}
 *
 * async someMethod() {
 *   const result = await this.schedulerService.enqueue(
 *     'unique-key',
 *     () => this.doSomething(),
 *     { maxRetries: 5 }
 *   );
 * }
 * ```
 */
@Module({
  controllers: [SchedulerController],
  providers: [
    {
      provide: SchedulerService,
      useFactory: () => {
        return new SchedulerService({ concurrencyLimit: 10 });
      },
    },
  ],
  exports: [SchedulerService],
})
export class SchedulerModule {}
