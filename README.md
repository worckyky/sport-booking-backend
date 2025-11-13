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
# Supabase Configuration
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Server Configuration
PORT=3001
FRONTEND_URL=http://localhost:3000

# Email Configuration
EMAIL_REDIRECT_URL=http://localhost:3000/auth/confirm
PASSWORD_RESET_REDIRECT_URL=http://localhost:3000/new-password
```

## Настройка SMTP для отправки email

Для отправки писем подтверждения регистрации необходимо настроить SMTP в Supabase.

### Если Supabase запущен из отдельного репозитория

1. Перейдите в директорию вашего Supabase проекта
2. Откройте файл `supabase/config.toml`
3. Найдите секцию `[auth.email]` и настройте SMTP:

```toml
[auth.email]
enable_signup = true
enable_confirmations = true

[auth.email.smtp]
enabled = true
host = "smtp.gmail.com"
port = 587
user = "your-email@gmail.com"
pass = "your-app-password"
admin_email = "your-email@gmail.com"
sender_name = "Sport Booking"
```

4. Перезапустите Supabase:
```bash
supabase stop
supabase start
```

### Production (Supabase Cloud)

1. Перейдите в Dashboard -> Project Settings -> Auth -> SMTP Settings
2. Включите "Enable Custom SMTP"
3. Заполните настройки SMTP провайдера
4. Сохраните изменения

**Важно**: 
- При локальной разработке email будут доступны в Inbucket по адресу http://localhost:54324
- Для Gmail нужно использовать App Password, а не обычный пароль
- В переменной `EMAIL_REDIRECT_URL` укажите URL вашего frontend для редиректа после подтверждения email
- В переменной `PASSWORD_RESET_REDIRECT_URL` укажите URL вашего frontend для редиректа при восстановлении пароля

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

**Важно**: После перехода по ссылке из письма, Supabase редиректит на ваш frontend (`/new-password`) с параметрами `access_token` и `refresh_token` в URL. Извлеките эти токены из URL и передайте в запросе.

При успешной смене пароля:
1. Пароль обновляется в Supabase
2. Cookie `auth_token` устанавливается автоматически - пользователь сразу авторизован
3. Возвращается ID пользователя и статус верификации email
4. Можно сразу переходить на защищенные страницы (например, `/profile`)

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
