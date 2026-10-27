# Исходники CleverVet Mobile v0.2

Инструкция обновления, ограничения и отчёт находятся на уровень выше:

- [README](../README.md)
- [CHANGELOG](../CHANGELOG.md)
- [API_LIMITATIONS](../API_LIMITATIONS.md)
- [TEST_REPORT](../TEST_REPORT.md)

```sh
npm ci
npm test
npm run build
```

Сборка — dist/. Не публикуйте исходный index.html без Vite. Все API-тесты используют mock fetch; JWT в терминале и файлах не нужен.
