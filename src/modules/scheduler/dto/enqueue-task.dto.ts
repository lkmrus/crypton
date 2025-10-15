import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
} from 'class-validator';

/**
 * DTO для добавления задачи в планировщик через HTTP API
 */
export class EnqueueTaskDto {
  /**
   * Уникальный ключ задачи для дедупликации
   * @example "send-email-user-123"
   */
  @IsString()
  @IsNotEmpty()
  key: string;

  /**
   * Тип задачи (используется для идентификации в логах и статистике)
   * @example "send-notification"
   */
  @IsString()
  @IsNotEmpty()
  taskType: string;

  /**
   * Произвольные данные для выполнения задачи
   * @example { "userId": 123, "message": "Hello" }
   */
  @IsOptional()
  payload?: any;

  /**
   * Максимальное количество попыток выполнения
   * @example 5
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxRetries?: number;

  /**
   * Базовая задержка между попытками в миллисекундах
   * @example 2000
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  baseDelay?: number;
}
