# Исходные ошибки регрессии общей ленты

Статус каждой исходной проверки обновляется только после выполнения эквивалентного сценария; открытые строки остаются блокерами.

| № | Исходный тест | Причина первоначального отказа | Статус |
|---:|---|---|---|
| 1 | tests/colorDose.test.tsx > Ветгаб: canonical 20 мг/кг and route match across all five views | Выбор новой строки пациента; исходные клинические и сетевые проверки сохранены | Пройдено |
| 2 | tests/colorDose.test.tsx > Серения: canonical 1 мг/кг and route match across all five views | Выбор новой строки пациента; исходные клинические и сетевые проверки сохранены | Пройдено |
| 3 | tests/colorDose.test.tsx > Спазмалгон: canonical 20 мг/кг and route match across all five views | Выбор новой строки пациента; исходные клинические и сетевые проверки сохранены | Пройдено |
| 4 | tests/colorDose.test.tsx > Акупан: canonical 0,3 мг/кг and route match across all five views | Выбор новой строки пациента; исходные клинические и сетевые проверки сохранены | Пройдено |
| 5 | tests/colorDose.test.tsx > Амоксиклав: canonical 20 мг/кг and route match across all five views | Выбор новой строки пациента; исходные клинические и сетевые проверки сохранены | Пройдено |
| 6 | tests/colorDose.test.tsx > Лидокаин: canonical 30 мкг/кг/мин and route match across all five views | Выбор новой строки пациента; исходные клинические и сетевые проверки сохранены | Пройдено |
| 7 | tests/resultEditor.test.tsx > full demo flow: editing enabled by default, save, history edit and confirmed delete update feed | Новый селектор раскрытия пациента; сохранены проверки сохранения комментария, истории, повторного открытия и удаления в демо | Пройдено (демо; сетевой мок отдельно не подтверждён) |
| 8 | tests/resultStatusesUi.test.tsx > App: past EXECUTED → planned updates grid, overdue feed and opened overview without page reload | Выбор новой строки пациента; исходные клинические и сетевые проверки сохранены | Пройдено |
| 9 | tests/resultStatusesUi.test.tsx > App: past NOT_EXECUTED → planned updates grid, overdue feed and opened overview without page reload | Выбор новой строки пациента; исходные клинические и сетевые проверки сохранены | Пройдено |
| 10 | tests/ui.test.tsx > Tranexam yellow every 8 hours appears at 15:00 Moscow while different result colors stay in history | Раскрытие новой строки: время 15:00 и цвета назначения и отметок проверены | Пройдено |
| 11 | tests/ui.test.tsx > missing revision color does not filter current or next-hour schedules | Текущий и следующий час сохраняют назначения без цвета редакции | Пройдено |
| 12 | tests/ui.test.tsx > at 10:31 the API worklist shows hourly current 10:00 and next 11:00 without extra GET on expansion | Часы 10:00 и 11:00 и отсутствие лишних GET проверены | Пройдено |
| 13 | tests/ui.test.tsx > opens a compact time-first worklist with collapsed patient rows and honest incomplete warning | Новые название блока, имя, число, раскрытие и предупреждения проверены | Пройдено |
| 14 | tests/ui.test.tsx > shows exact next-hour time, dose, route, concentration, instruction and solution rate without raw technical fields | Проверены время, доза, путь, объём, инструкция и скорость | Пройдено |
| 15 | tests/ui.test.tsx > global category filters apply to every patient's current and next-hour groups | Фильтр категории проверен для пациентов и часовых блоков | Пройдено |
| 16 | tests/ui.test.tsx > individual patient defaults to the same worklist and can switch to grid and back without GET | Переход через список пациентов, индивидуальная лента, сетка и отсутствие лишнего GET проверены | Пройдено |
| 17 | tests/ui.test.tsx > partial API failures keep successful patients usable and do not claim full success | Проверены частичная ошибка загрузки и доступность оставшегося пациента | Пройдено |
| 18 | tests/ui.test.tsx > large worklists use windowing rather than pages, and grid stays virtualized | Проверены виртуализация раскрытого большого списка и сетки | Пройдено |
| 19 | tests/ui.test.tsx > refresh removes a newly marked task, keeps other tasks, expansion and scroll container | Проверены обновление отметки, раскрытие пациента и положение прокрутки | Пройдено |
| 20 | tests/ui.test.tsx > a failed department refresh remains retryable and never advances the successful timestamp | Проверены повторная попытка и отсутствие ложного времени успеха | Пройдено |
| 21 | tests/ui.test.tsx > auto-refresh is optional, preserves expansion, and hour changes regroup without fetching on scroll | Проверены автообновление, раскрытие, смена часа и отсутствие лишних запросов | Пройдено |
| 22 | tests/ui.test.tsx > pagehide keeps the active session for Safari tab restoration | Проверены pagehide и сохранение текущего сеанса | Пройдено |
| 23 | tests/ui.test.tsx > rounded zero-window assignment moves from next hour to done and the patient counters reuse cached data | Проверены однократное окно, статус done с нулевым счётчиком и кеш | Пройдено |
| 24 | tests/ui.test.tsx > structured mg/kg yields the same dose/volume in both feeds and details; diagnostics hides raw IDs by default | Проверены мг/кг, полная доза, объём и детали в обеих лентах | Пройдено |
| 25 | tests/ui.test.tsx > rate dosage stays per minute in the working feed and never says to draw a bolus | Проверены единицы скорости и отсутствие ошибочного болюса | Пройдено |
| 26 | tests/ui.test.tsx > unknown dose units produce only a local warning while the valid medication stays clear | Проверены локальное предупреждение о неизвестных единицах и корректное соседнее назначение | Пройдено |
| 27 | tests/v041.test.tsx > initial login selects authorized target IDs without wrong or duplicate startup requests | Выбор отделения проверен по запросам и подписи в меню фильтров | Пройдено |
| 28 | tests/v041.test.tsx > Lidocaine 10 µg/kg/min is visible in general feed, individual feed, details, and editor | Выбор новой строки пациента; исходные клинические и сетевые проверки сохранены | Пройдено |
| 29 | tests/v041.test.tsx > Lidocaine 20 µg/kg/min is visible in general feed, individual feed, details, and editor | Выбор новой строки пациента; исходные клинические и сетевые проверки сохранены | Пройдено |
| 30 | tests/v041.test.tsx > Lidocaine 40 µg/kg/min is visible in general feed, individual feed, details, and editor | Выбор новой строки пациента; исходные клинические и сетевые проверки сохранены | Пройдено |
| 31 | tests/v041.test.tsx > Lidocaine 50 µg/kg/min is visible in general feed, individual feed, details, and editor | Выбор новой строки пациента; исходные клинические и сетевые проверки сохранены | Пройдено |

## Текущая проверка

- Полный прогон после добавления ручных результатов: 853 теста прошли, 31 не прошёл (5 файлов); исходные строки выше пока не закрыты.
- 12 тестов представления статусов и ручных результатов, 9 тестов периодов и 17 тестов ручных назначений прошли. Эти модульные проверки не заменяют полный цикл изменения отметки из новой ленты.
- Окно назначения открывается из текущего блока на демоданных в Chromium при ширине 375, 390 и 430 px; запись и обработка ошибки в этом сценарии ещё не проверены.
- Оставшиеся блокеры: эквивалентные проверки всех 31 сценария, полный цикл записи и повторного чтения, ручные неизвестные отметки через UI, виртуализация большого списка и проверка Safari на iPhone.
- Публикация и коммит не выполнялись.

## Проверка последней версии

- Полный прогон: 855 пройдено, 30 ошибок. Один исходный сценарий результата обновлён под новую строку и прошёл без удаления проверок.
- Целевые проверки фотографий, периодов и ручных результатов: 68 из 68.
- При эмуляции Europe/Moscow проверена доступность последнего элемента над навигацией на 375, 390 и 430 px; прежний UTC соответствовал часовому поясу браузера эмуляции.
- Остальные 30 исходных сценариев, сетевой цикл сохранения из новой ленты и реальные фото остаются непроверенными.

## Последний прогон

- 870 тестов прошли, 17 не прошли в ui.test.tsx (включая 2 новых сетевых сценария).
- EXECUTED и NOT_EXECUTED: PUT из общей ленты, адрес карты и редакции, тело, повторный GET и история проверены на моках.
- Возврат в запланированное: DELETE, GET и красный счётчик проверены для обоих статусов.
- Ручная неизвестная отметка и ошибка записи через новую ленту остаются неподтверждёнными; публикации нет.

## Итоговый локальный прогон

- 17 прежних сценариев прошли в ui.test.tsx; старые проверки клинических данных и запросов сохранены или проверены через соответствующее новое представление.
- Мок API: сохранение EXECUTED и NOT_EXECUTED, запросы и повторный GET подтверждены; ошибочный PUT требует обновления перед повтором, после чего сохранение проходит.
- Ручное неизвестное событие открывается с исходными статусом и временем; конфликтующие отметки открываются обе.
- Физический iPhone Safari и реальная загрузка фотографий пациентов не проверялись. Коммит и публикация запрещены до согласования.

## Проверка после закрытия 17 сценариев

- Полный прогон: 889 из 889; сборка проходит. Все 31 исходных теста выполнены в составе полного набора без skip или удаления.
- Ручные неизвестные отметки: оба варианта отсутствующей периодичности проверены через ленту и открытие деталей с исходным временем и статусом; проверены две конфликтующие отметки. Мок записи для такого неизвестного статуса не выполнялся.
- Ошибка PUT проверена через ленту: сообщение об ошибке, отсутствие отметки и подтверждения, обновление перед повтором и успешная повторная попытка.
- Вертикальная виртуализация раскрытого большого списка и сетки проверена тестом; фотографии и мобильный DOM проверялись на фиктивных/демонстрационных данных.
- Проверка Safari на физическом iPhone и фотографии реальных пациентов не проводились. Коммит и публикация не выполнялись.
