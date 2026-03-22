#!/bin/bash
# Smoke test — проверяет основные endpoints после деплоя
# Использование: ./scripts/smoke-test.sh [BASE_URL]
# По умолчанию: http://localhost:3001

BASE_URL="${1:-http://localhost:3001}"
PASS=0
FAIL=0

check() {
  local name="$1"
  local method="$2"
  local url="$3"
  local expected_status="$4"
  local body="$5"

  if [ -n "$body" ]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url" \
      -H "Content-Type: application/json" -d "$body" --cookie-jar /tmp/smoke-cookies --cookie /tmp/smoke-cookies)
  else
    status=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$url" \
      --cookie-jar /tmp/smoke-cookies --cookie /tmp/smoke-cookies)
  fi

  if [ "$status" = "$expected_status" ]; then
    echo "  OK  $name ($status)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name (expected $expected_status, got $status)"
    FAIL=$((FAIL + 1))
  fi
}

echo "Smoke test: $BASE_URL"
echo "---"

# Health
check "GET /health" GET "$BASE_URL/health" 200

# Server time
check "GET /server-time" GET "$BASE_URL/server-time" 200

# Auth — signin (test account)
check "POST /auth/signin" POST "$BASE_URL/auth/signin" 200 \
  '{"email":"player@test.com","password":"test123"}'

# Profile (requires auth cookie from signin)
check "GET /auth/profile" GET "$BASE_URL/auth/profile" 200

# Catalog (public)
check "GET /booking/catalog" GET "$BASE_URL/booking/catalog" 200

# Signout
check "POST /auth/signout" POST "$BASE_URL/auth/signout" 200

# Profile after signout (should fail)
check "GET /auth/profile (unauth)" GET "$BASE_URL/auth/profile" 401

echo "---"
echo "Results: $PASS passed, $FAIL failed"

# Cleanup
rm -f /tmp/smoke-cookies

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
