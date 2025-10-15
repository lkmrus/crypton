# Типизированный планировщик задач

Автор: **Лукманов Руслан Равилевич**

## Описание

Гибкий планировщик задач для Node.js с поддержкой TypeScript, предоставляющий полный контроль над выполнением асинхронных операций.

### Ключевые возможности

✅ **Контроль параллельности** - настраиваемое ограничение одновременно выполняемых задач  
✅ **Дедупликация** - автоматическое объединение конкурентных запросов с одинаковым ключом  
✅ **Умные повторы** - автоматические retry при сбоях с экспоненциальной задержкой и jitter  
✅ **Graceful Shutdown** - корректное завершение с ожиданием активных задач  
✅ **Подробная статистика** - мониторинг выполнения задач в реальном времени  
✅ **HTTP API** - удобное управление через REST эндпоинты  
✅ **Полная типизация** - строгая типобезопасность TypeScript  
✅ **Нативная реализация** - без внешних зависимостей для очередей и повторов

---

## Установка

Модуль встроен в проект. Импортируйте `SchedulerModule` в ваш модуль:

```typescript
import { Module } from '@nestjs/common';
import { SchedulerModule } from './modules/scheduler/scheduler.module';

@Module({
  imports: [SchedulerModule],
})
export class AppModule {}
```

---

## Быстрый старт

### Программный API

```typescript
import { Injectable } from '@nestjs/common';
import { SchedulerService } from './modules/scheduler/scheduler.service';

@Injectable()
export class MyService {
  constructor(private schedulerService: SchedulerService) {}

  async processUser(userId: number) {
    // Добавляем задачу в планировщик
    const result = await this.schedulerService.enqueue(
      `process-user-${userId}`,  // уникальный ключ
      async () => {
        // Ваша логика обработки
        const user = await this.fetchUser(userId);
        await this.processData(user);
        return { success: true, userId };
      },
      {
        maxRetries: 3,      // максимум 3 попытки
        baseDelay: 1000,    // базовая задержка 1 сек
      }
    );

    return result;
  }
}
```

### HTTP API

```bash
# Добавить задачу в очередь
curl -X POST http://localhost:3000/scheduler/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "key": "send-email-123",
    "taskType": "email-notification",
    "payload": { "userId": 123, "template": "welcome" },
    "maxRetries": 5,
    "baseDelay": 2000
  }'

# Получить статистику
curl http://localhost:3000/scheduler/stats

# Проверить здоровье планировщика
curl http://localhost:3000/scheduler/health

# Инициировать graceful shutdown
curl -X POST http://localhost:3000/scheduler/shutdown
```

---

## Детальное использование

### Конфигурация планировщика

При создании планировщика можно указать лимит параллельности:

```typescript
import { SchedulerService } from './modules/scheduler/scheduler.service';

// Создание с кастомным лимитом
const scheduler = new SchedulerService({ 
  concurrencyLimit: 5  // не более 5 задач одновременно
});
```

### Добавление задач

```typescript
// Простая задача
await scheduler.enqueue(
  'unique-key',
  async () => {
    return await someAsyncOperation();
  }
);

// Задача с retry конфигурацией
await scheduler.enqueue(
  'retry-task',
  async () => {
    return await unreliableOperation();
  },
  {
    maxRetries: 5,      // 5 попыток
    baseDelay: 2000,    // начальная задержка 2 сек
    jitter: 0.2,        // ±20% случайности
  }
);
```

### Дедупликация задач

Если несколько запросов с одним ключом поступают одновременно, выполняется только одна задача, а все получатели получают одинаковый результат:

```typescript
// Эти три вызова выполнят задачу только один раз
const promises = [
  scheduler.enqueue('fetch-user-123', () => fetchUser(123)),
  scheduler.enqueue('fetch-user-123', () => fetchUser(123)),
  scheduler.enqueue('fetch-user-123', () => fetchUser(123)),
];

const results = await Promise.all(promises);
// Все три результата будут идентичными
// stats.deduplicated === 2
```

### Механизм повторов

При сбое задача автоматически повторяется с увеличивающейся задержкой:

```typescript
// Формула задержки: delay = baseDelay * (2 ^ attempt) ± jitter

// Пример с baseDelay=1000ms, jitter=20%:
// Попытка 1: немедленно
// Попытка 2: ~1000ms ±20%  (800-1200ms)
// Попытка 3: ~2000ms ±20%  (1600-2400ms)
// Попытка 4: ~4000ms ±20%  (3200-4800ms)

const result = await scheduler.enqueue(
  'unstable-task',
  async () => {
    // Эта функция будет повторена до 3 раз при ошибке
    return await callUnstableAPI();
  },
  {
    maxRetries: 3,
    baseDelay: 1000,
    jitter: 0.2,
  }
);
```

### Graceful Shutdown

Корректное завершение работы планировщика:

```typescript
// Инициировать shutdown
await scheduler.shutdown();

// Что происходит:
// 1. Новые задачи отклоняются с ошибкой
// 2. Ожидающие задачи отменяются
// 3. Активные задачи завершаются нормально
// 4. Promise резолвится когда все активные задачи завершены

// После shutdown новые задачи будут отклонены
try {
  await scheduler.enqueue('new-task', async () => {});
} catch (error) {
  console.log(error.message); // "Scheduler is shutting down..."
}
```

### Получение статистики

```typescript
const stats = scheduler.getStats();

console.log(stats);
// {
//   enqueued: 100,       // всего добавлено задач
//   running: 5,          // выполняются сейчас
//   pending: 10,         // ожидают в очереди
//   completed: 80,       // успешно завершены
//   deduplicated: 15,    // дедуплицированы
//   retried: 25,         // кол-во повторов
//   failed: 3,           // провалены после всех попыток
//   cancelled: 2,        // отменены
// }
```

---

## HTTP API Reference

### POST /scheduler/tasks

Добавляет задачу в очередь.

**Request Body:**
```json
{
  "key": "unique-task-key",
  "taskType": "task-identifier",
  "payload": { "any": "data" },
  "maxRetries": 3,
  "baseDelay": 1000
}
```

**Response:**
```json
{
  "key": "unique-task-key",
  "status": "PENDING",
  "message": "Task enqueued successfully"
}
```

### GET /scheduler/stats

Возвращает статистику выполнения задач.

**Response:**
```json
{
  "enqueued": 100,
  "running": 5,
  "pending": 10,
  "completed": 80,
  "deduplicated": 15,
  "retried": 25,
  "failed": 3,
  "cancelled": 2
}
```

### GET /scheduler/health

Проверяет состояние планировщика.

**Response:**
```json
{
  "status": "healthy",
  "isShuttingDown": false,
  "runningTasks": 5,
  "pendingTasks": 10
}
```

### POST /scheduler/shutdown

Инициирует graceful shutdown.

**Response:**
```json
{
  "message": "Shutdown initiated",
  "status": "shutting_down"
}
```

---

## Примеры использования

### Пример 1: Отправка email уведомлений

```typescript
@Injectable()
export class EmailService {
  constructor(private scheduler: SchedulerService) {}

  async sendWelcomeEmail(userId: number, email: string) {
    return this.scheduler.enqueue(
      `welcome-email-${userId}`,
      async () => {
        await this.emailProvider.send({
          to: email,
          template: 'welcome',
          data: { userId },
        });
        return { sent: true, userId };
      },
      {
        maxRetries: 5,      // важные письма - больше попыток
        baseDelay: 2000,    // начинаем с 2 секунд
      }
    );
  }
}
```

### Пример 2: Обработка данных с дедупликацией

```typescript
@Injectable()
export class DataProcessingService {
  constructor(private scheduler: SchedulerService) {}

  async processReport(reportId: string) {
    // Если несколько запросов на один отчет придут одновременно,
    // обработка произойдет только один раз
    return this.scheduler.enqueue(
      `report-${reportId}`,
      async () => {
        const data = await this.fetchReportData(reportId);
        const processed = await this.heavyProcessing(data);
        await this.saveResults(reportId, processed);
        return processed;
      },
      {
        maxRetries: 2,
        baseDelay: 5000,
      }
    );
  }
}
```

### Пример 3: Интеграция с внешними API

```typescript
@Injectable()
export class ExternalAPIService {
  constructor(private scheduler: SchedulerService) {}

  async fetchUserData(userId: number) {
    return this.scheduler.enqueue(
      `api-user-${userId}`,
      async () => {
        const response = await fetch(`https://api.example.com/users/${userId}`);
        if (!response.ok) {
          throw new Error(`API Error: ${response.status}`);
        }
        return response.json();
      },
      {
        maxRetries: 4,
        baseDelay: 1000,
        jitter: 0.3,  // больший jitter для API запросов
      }
    );
  }
}
```

### Пример 4: Мониторинг и алерты

```typescript
@Injectable()
export class MonitoringService {
  constructor(private scheduler: SchedulerService) {}

  @Cron('*/5 * * * * *') // каждые 5 секунд
  checkSchedulerHealth() {
    const stats = this.scheduler.getStats();
    
    // Проверяем критические метрики
    if (stats.failed > 100) {
      this.alertService.sendAlert('High failure rate in scheduler');
    }
    
    if (stats.pending > 1000) {
      this.alertService.sendAlert('Queue is growing too large');
    }
    
    // Логируем статистику
    this.logger.log('Scheduler stats:', stats);
  }
}
```

---

## Архитектура

### Компоненты системы

```
┌─────────────────────────────────────────┐
│         SchedulerController            │  ← HTTP API
├─────────────────────────────────────────┤
│         SchedulerService               │  ← Основная логика
├─────────────────────────────────────────┤
│  • Queue Management                    │
│  • Concurrency Control                 │
│  • Deduplication Logic                 │
│  • Retry Mechanism                     │
│  • Statistics Collection               │
└─────────────────────────────────────────┘
```

### Поток выполнения задачи

```
1. enqueue(key, task, config)
   ↓
2. Проверка shutdown
   ↓
3. Проверка дедупликации
   ↓
4. Добавление в очередь
   ↓
5. processQueue() - запуск если есть свободные слоты
   ↓
6. executeTask() - выполнение с retry
   ↓
7. Успех/Неудача → обновление статистики
   ↓
8. processQueue() - запуск следующей задачи
```

---

## Тестирование

Проект включает комплексные тесты:

- **19 unit тестов** для SchedulerService
- **20 integration тестов** для SchedulerController
- **Coverage >90%**

Запуск тестов:

```bash
# Все тесты модуля
npm test -- scheduler

# Только unit тесты
npm test -- scheduler.service.spec.ts

# Только integration тесты
npm test -- scheduler.controller.spec.ts

# С coverage
npm run test:cov
```

---

## Технические детали

### Ограничения и рекомендации

- **Лимит параллельности:** Рекомендуется устанавливать в зависимости от ресурсов системы (CPU, память)
- **Размер очереди:** Планировщик не ограничивает размер очереди - следите за памятью
- **Ключи задач:** Используйте уникальные и описательные ключи для лучшей дедупликации
- **Retry стратегия:** Для критичных задач увеличивайте maxRetries, для быстрых - уменьшайте

### Production готовность

✅ Полная типизация TypeScript  
✅ Обработка всех edge cases  
✅ Graceful shutdown  
✅ Подробное логирование  
✅ Комплексное тестирование  
✅ Мониторинг и статистика  

---

## Лицензия

UNLICENSED

---

## Автор

**Лукманов Руслан Равилевич**  
Email: lkmrus@gmail.com

---

## Дополнительная информация

### Troubleshooting

**Q: Задачи выполняются медленно**  
A: Увеличьте `concurrencyLimit` при создании планировщика

**Q: Слишком много повторов**  
A: Уменьшите `maxRetries` или увеличьте `baseDelay`

**Q: Память растет**  
A: Проверьте размер очереди (`stats.pending`), возможно задачи добавляются быстрее чем выполняются

**Q: Задачи не дедуплицируются**  
A: Убедитесь, что используете одинаковые ключи для идентичных задач

### Roadmap

Планируемые улучшения:
- [ ] Приоритеты задач
- [ ] Персистентная очередь (Redis/Database)
- [ ] WebSocket события для real-time мониторинга
- [ ] Кастомные стратегии retry
- [ ] Rate limiting
