# Sport Booking Backend

Простой Node.js прокси-сервер для Supabase на TypeScript.

## Установка

```bash
npm install
```

## Запуск в режиме разработки

```bash
npm run dev
```

## Сборка и запуск в продакшене

```bash
npm run build
npm start
```

## Запуск в Docker

### Быстрые команды
```bash
# Запустить контейнер
npm run docker:up

# Остановить контейнер
npm run docker:down

# Перезапустить с пересборкой
npm run docker:restart

# Посмотреть логи
npm run docker:logs

# Только собрать образ
npm run docker:build
```

### Альтернативные команды
```bash
# Запуск с логами
docker-compose up

# Запуск в фоне
docker-compose up -d

# Остановка и удаление контейнеров
docker-compose down

# Пересборка и запуск
docker-compose up --build -d
```

## Переменные окружения

Создайте файл `.env` на основе `env-example.txt`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
PORT=3001
```

## API Endpoints

### Health Check
```
GET /health
```

### Authentication
```
POST /auth/signin
POST /auth/signup
POST /auth/signout
GET  /auth/profile
PUT  /auth/profile
```

#### Регистрация пользователя (Sign Up)
```
POST /auth/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "name": "John Doe",      // опционально
  "phone": "+1234567890"   // опционально
}
```

При успешной регистрации:
1. Создается пользователь в Supabase Auth
2. Автоматически добавляется запись в таблицу `users` PostgreSQL
3. Заполняются поля: id, email, name, phone, registration_date, role

#### Получение профиля
```
GET /auth/profile
Headers: user-id: <user-uuid>
```

#### Обновление профиля
```
PUT /auth/profile
Headers: user-id: <user-uuid>
Content-Type: application/json

{
  "name": "Updated Name",
  "phone": "+1987654321"
}
```

### Database Queries
```
POST /db/query
```

### Generic Supabase Proxy
```
ALL /supabase/*
```

## Docker

Проект настроен для запуска в Docker контейнере с multi-stage сборкой для оптимизации размера образа.
# sport-booking-backend
