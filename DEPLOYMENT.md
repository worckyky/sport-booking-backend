# Деплой на Coolify

## Подготовка проекта

Проект настроен для деплоя на Coolify с автоматическим билдом Docker-образа.

### Требования

- Coolify instance
- GitHub/GitLab репозиторий
- Supabase проект

## Шаги деплоя

### 1. Создание проекта в Coolify

1. Зайдите в Coolify dashboard
2. Создайте новый проект или используйте существующий
3. Добавьте новый resource → Docker Compose

### 2. Подключение репозитория

1. Выберите ваш Git provider (GitHub/GitLab)
2. Укажите репозиторий: `your-org/sport-booking-backend`
3. Выберите ветку: `main`

### 3. Конфигурация домена

В настройках Coolify укажите:
- **Domain**: `api.walknplay.ru`
- **Port**: `3001` (внутренний порт контейнера)

Coolify автоматически настроит:
- SSL сертификат (Let's Encrypt)
- Reverse proxy (Traefik)

### 4. Настройка переменных окружения

В разделе Environment Variables добавьте следующие переменные:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Server Configuration
PORT=3001
NODE_ENV=production

# CORS Configuration
ALLOWED_ORIGINS=https://stage.walknplay.ru,https://walknplay.ru

# Email Redirect URLs
EMAIL_REDIRECT_URL=https://stage.walknplay.ru/confirm
FRONTEND_URL=https://stage.walknplay.ru
PASSWORD_RESET_REDIRECT_URL=https://stage.walknplay.ru/new-password
```

#### Где взять ключи Supabase:

1. Откройте ваш проект в [Supabase Dashboard](https://app.supabase.com)
2. Перейдите в Settings → API
3. Скопируйте:
   - `URL` → `SUPABASE_URL`
   - `anon/public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

### 5. Запуск деплоя

1. Нажмите "Deploy" в Coolify
2. Coolify автоматически:
   - Склонирует репозиторий
   - Соберет Docker образ согласно Dockerfile
   - Запустит контейнер с docker-compose.yml
   - Настроит reverse proxy на домен

### 6. Проверка деплоя

После успешного деплоя проверьте:

1. **Health check**: https://api.walknplay.ru/health

   Должен вернуть:
   ```json
   {
     "status": "ok",
     "timestamp": "2024-..."
   }
   ```

2. **API Docs**: https://api.walknplay.ru/api-docs

   Должен открыться Swagger UI с документацией API

3. **CORS**: Проверьте что фронтенд может делать запросы к API

## Мониторинг

### Логи

Просмотр логов в Coolify:
- Перейдите в ваш resource
- Вкладка "Logs"
- Выберите сервис "backend"

### Healthcheck

Coolify автоматически мониторит healthcheck endpoint:
- Endpoint: `/health`
- Интервал: 30 секунд
- Timeout: 10 секунд
- Retries: 3

Если healthcheck падает 3 раза подряд, Coolify попытается перезапустить контейнер.

## Обновление приложения

### Автоматическое обновление (рекомендуется)

В Coolify можно настроить автоматический деплой при push в main ветку:
1. В настройках resource включите "Auto Deploy"
2. При каждом push в main ветку Coolify автоматически пересоберет и задеплоит приложение

### Ручное обновление

1. Зайдите в Coolify dashboard
2. Выберите ваш resource
3. Нажмите "Redeploy"

## Откат изменений

Если что-то пошло не так:
1. В Coolify перейдите в "Deployments"
2. Выберите предыдущий успешный деплой
3. Нажмите "Redeploy"

## Масштабирование

Для увеличения мощности:
1. В Coolify settings можно увеличить ресурсы (CPU/Memory)
2. Для horizontal scaling настройте несколько инстансов (в настройках resource)

## Troubleshooting

### Приложение не запускается

1. Проверьте логи в Coolify
2. Убедитесь что все environment variables заданы
3. Проверьте что Supabase credentials корректны

### CORS ошибки

Убедитесь что `ALLOWED_ORIGINS` включает домен фронтенда:
```env
ALLOWED_ORIGINS=https://stage.walknplay.ru,https://walknplay.ru
```

### Healthcheck падает

1. Проверьте что приложение запустилось (логи)
2. Убедитесь что PORT=3001
3. Проверьте что в Dockerfile EXPOSE 3001

## Бэкап

Настройте регулярный бэкап environment variables:
1. Экспортируйте .env файл из Coolify
2. Сохраните в безопасном месте (1Password, Vault)

## Безопасность

- Никогда не коммитьте `.env` файл в git
- Используйте strong secrets для `SUPABASE_SERVICE_ROLE_KEY`
- Регулярно ротируйте ключи в Supabase
- Включите SSL/HTTPS (Coolify делает это автоматически)

## Поддержка

При проблемах с деплоем:
1. Проверьте логи в Coolify
2. Проверьте документацию Coolify: https://coolify.io/docs
3. Проверьте status страницу Supabase: https://status.supabase.com