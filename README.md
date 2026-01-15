# Sport Booking Backend

Node.js backend на TypeScript с прямым подключением к PostgreSQL.

## Деплой

Для деплоя на Coolify смотрите [инструкцию по деплою](./DEPLOYMENT.md).

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
docker-compose -f docker-compose-dev.yml up

# Запуск в фоне
docker-compose -f docker-compose-dev.yml up -d

# Остановка и удаление контейнеров
docker-compose -f docker-compose-dev.yml down

# Пересборка и запуск
docker-compose -f docker-compose-dev.yml up --build -d
```

### Локальная PostgreSQL (инициализация схемы)

В `docker-compose-dev.yml` добавлен сервис `db` (PostgreSQL). При **первом** старте контейнера он автоматически применит схему из `migrations/001_init.sql`.

### Миграции через Umzug

Чтобы применить миграции вручную к базе из `DATABASE_URL`:

```bash
npm run migrate
```

## Переменные окружения

Создайте файл `.env`:

```
# Database
DATABASE_URL=postgres://user:password@localhost:5432/sport_booking
# true если вы подключаетесь к Postgres по SSL (например managed)
DB_SSL=false

# Auth
JWT_SECRET=change-me-to-a-long-random-secret

# Server Configuration
PORT=3001
FRONTEND_URL=http://localhost:3000

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:3000
```

## Миграции базы

В репозитории добавлена миграция схемы: `migrations/001_init.sql`.

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
POST /auth/reset-password
POST /auth/new-password
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
1. Создается пользователь в таблице `users` PostgreSQL
2. Устанавливается cookie `auth_token` (JWT) на 7 дней
3. Возвращается `id` и статус `email_verified`

#### Получение профиля
```
GET /auth/profile
```

#### Обновление профиля
```
PUT /auth/profile
Content-Type: application/json

{
  "name": "Updated Name",
  "phone": "+1987654321"
}
```

#### Восстановление пароля (Reset Password)
```
POST /auth/reset-password
Content-Type: application/json

{
  "email": "user@example.com"
}
```

При успешном запросе:
1. На указанный email отправляется письмо с ссылкой восстановления
2. Ссылка ведет на `/new-password` с токеном в параметрах
3. Пользователь попадает на форму ввода нового пароля

**Важно**: Для настройки URL перенаправления используйте переменную окружения `PASSWORD_RESET_REDIRECT_URL`

#### Установка нового пароля (New Password)
```
POST /auth/new-password
Content-Type: application/json

{
  "password": "newPassword123",
  "confirmPassword": "newPassword123",
  "access_token": "token-from-url",
  "refresh_token": "refresh-token-from-url"  // опционально, но рекомендуется
}
```

**Важно**: эндпоинт `/auth/reset-password` возвращает одноразовый `access_token` (reset token). Его нужно передать в `/auth/new-password` как `access_token`. `refresh_token` больше не используется и оставлен только для обратной совместимости.

### Database Queries
```
POST /db/query
```

## Docker

Проект настроен для запуска в Docker контейнере с multi-stage сборкой для оптимизации размера образа.
# sport-booking-backend
