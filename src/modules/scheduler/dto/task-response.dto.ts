import { TaskStatus } from '../types/scheduler.types';

/**
 * DTO для ответа при добавлении задачи
 */
export class TaskResponseDto {
  /**
   * Уникальный ключ задачи
   */
  key: string;

  /**
   * Статус задачи
   */
  status: string;

  /**
   * Сообщение о результате
   */
  message: string;

  /**
   * Была ли задача дедуплицирована
   */
  deduplicated?: boolean;

  constructor(
    key: string,
    status: TaskStatus | string,
    message: string,
    deduplicated?: boolean,
  ) {
    this.key = key;
    this.status = status;
    this.message = message;
    this.deduplicated = deduplicated;
  }
}

