/**
 * АртТич - приёмник записи пробного и шлюз к таблице учёта.
 *
 * Свойства скрипта (Настройки проекта - Свойства скрипта):
 *   TG_TOKEN  - токен бота от BotFather
 *   TG_CHAT   - куда слать: findChat (личка), addGroup или useGroupOnly (группа).
 *               Можно несколько через запятую; тема форума пишется «id_чата:id_темы».
 *   TG_TASKS  - отдельный адрес для уведомлений о задачах, задаётся функцией setTasksTopic.
 *               Пусто - задачи идут туда же, куда пробные.
 *   SHEET_ID  - id таблицы учёта, заполняется функцией setupUchet
 *   ADMIN_KEY - ключ доступа к админке, создаётся функцией setupUchet
 *   ASSIST_KEY - ключ Насти: открывает только воронку лидов на странице скрипта.
 *               Задаётся вручную в свойствах скрипта. Учеников, оплаты и группы
 *               по нему не отдаём, даже если он утечёт.
 *
 * Цвета в календаре: жёлтый - окно свободно, фиолетовый - записано пробное.
 */

var CAL_ID = 'b43eb3d7776bfcea6809d656966accc9e36cc6cdcf0ea8b0c5b093a514086e67@group.calendar.google.com';
var FREE_TITLE = 'Свободно для пробного';

var SHEETS = {
  'Лиды':    ['id','дата','ник','родитель','класс','предмет','цель','статус','предложили','пробное','след_шаг','след_дата','источник','заметка','этап','ход','обновлён','причина'],
  'Группы':  ['id','название','предмет','класс','формат','дни','преподаватель','заметка','абонемент','мест','минуты'],
  'Ученики': ['id','ученик','класс','предмет','формат','группа','абонемент','родитель','источник','старт','discord','holst','статус','заметка','перерыв_с','перерыв_по','окончание','инд_цена','инд_минуты','телеграм','телефон','инстаграм','род_телеграм','род_телефон','род_инстаграм'],
  'Направления': ['id','ученик','предмет','формат','группа','абонемент','цена_занятия','минуты','заметка','дни'],
  'Оплаты':  ['id','дата','ученик','месяц','сумма','чек','заметка'],
  'Счета':   ['id','создан','ученик','предмет','формат','направление','период_с','период_по','период',
              'занятий','цена','полная','скидка','сумма','статус','оплата_id','отправлен','текст'],
  'Задачи':  ['id','создана','что','кого','срок','кто','сделано','текст','исполнитель','проект','ключ'],
  'Проекты': ['id','название','заметка'],
  'Контакты':['id','создан','ник','пробное','телеграм','вайбер','почта','ключ']
};

function props() { return PropertiesService.getScriptProperties(); }
function cfg(key) { return props().getProperty(key) || ''; }

/* ——— Telegram ——— */

/**
 * TG_CHAT может содержать несколько адресов через запятую: личка, группа, ещё группа.
 * Для темы в форуме пишется «id_чата:id_темы», например «-1001234567890:12».
 */
function tgChats() {
  return cfg('TG_CHAT').split(',').map(function (s) { return s.trim(); })
                       .filter(function (s) { return s.length; });
}

/** Одно сообщение одному адресату. Адрес: id чата или id чата:id топика. */
function tgSend(target, text) {
  var token = cfg('TG_TOKEN');
  if (!token || !target) return '';
  var payload = { chat_id: target, text: text, disable_web_page_preview: 'true' };
  var parts = String(target).split(':');
  if (parts.length === 2) { payload.chat_id = parts[0]; payload.message_thread_id = parts[1]; }
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  });
  return target + ' -> ' + res.getContentText();
}

function tg(text) {
  var token = cfg('TG_TOKEN');
  var chats = tgChats();
  if (!token || !chats.length) return 'нет TG_TOKEN или TG_CHAT в свойствах скрипта';
  return chats.map(function (chat) { return tgSend(chat, text); }).join('\n');
}

/** Уведомления о задачах: в топик из TG_TASKS, а если он не задан - туда же, куда пробные. */
function tgTasks(text) {
  var target = cfg('TG_TASKS');
  return target ? tgSend(target, text) : tg(text);
}

/** Одно сообщение с повтором: на «слишком часто» телеграм говорит, сколько ждать. */
function tgSendRetry(target, text) {
  var r = '';
  for (var i = 0; i < 4; i++) {
    r = tgSend(target, text);
    var m = r.match(/"retry_after":(\d+)/);
    if (!m) return r;
    Utilities.sleep((Number(m[1]) + 1) * 1000);
  }
  return r;
}

/**
 * Счета из кабинета. items - [{id, messages:[...]}]: у каждого счёта свои сообщения,
 * они уходят всем адресатам TG_CHAT по порядку. Отметку mark {sheet, field, value}
 * получает только тот счёт, чьи сообщения ушли все и всем - тогда повторная
 * отправка из кабинета не задублирует уже ушедшие.
 */
function tgBatch(d) {
  var chats = tgChats();
  if (!cfg('TG_TOKEN') || !chats.length) {
    return { ok: false, sent: [], error: 'в свойствах скрипта нет TG_TOKEN или TG_CHAT' };
  }
  var items = (d.items || []).slice(0, 60);
  var m = d.mark || {};
  var canMark = SHEETS[m.sheet] && m.field && SHEETS[m.sheet].indexOf(m.field) >= 0;
  var sent = [], failed = 0;
  items.forEach(function (it) {
    var good = (it.messages || []).every(function (text) {
      var ok = chats.every(function (c) {
        return tgSendRetry(c, String(text || '')).indexOf('"ok":true') >= 0;
      });
      Utilities.sleep(400);
      return ok;
    });
    if (!good) { failed++; return; }
    if (canMark && it.id) {
      var patch = {};
      patch[m.field] = m.value;
      updateRow(m.sheet, it.id, patch);
    }
    sent.push(it.id);
  });
  if (failed) return { ok: false, sent: sent, error: 'телеграм не принял ' + failed + ' из ' + items.length };
  return { ok: true, sent: sent };
}

/* ——— Календарь ——— */

function eventAt(startIso) {
  var cal   = CalendarApp.getCalendarById(CAL_ID);
  var start = new Date(startIso);
  var list  = cal.getEvents(new Date(start.getTime() - 60000),
                            new Date(start.getTime() + 60000));
  for (var i = 0; i < list.length; i++) {
    if (Math.abs(list[i].getStartTime().getTime() - start.getTime()) < 60000) return list[i];
  }
  return null;
}

/* ——— Таблица учёта ——— */

/** Разовая настройка: создаёт таблицу с листами и ключ доступа. */
function setupUchet() {
  var id = cfg('SHEET_ID');
  var ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('АртТич - учёт');
    props().setProperty('SHEET_ID', ss.getId());
  }
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var head = SHEETS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  var def = ss.getSheetByName('Лист1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  if (!cfg('ADMIN_KEY')) {
    var abc = 'abcdefghijkmnpqrstuvwxyz23456789';
    var k = '';
    for (var i = 0; i < 32; i++) k += abc.charAt(Math.floor(Math.random() * abc.length));
    props().setProperty('ADMIN_KEY', k);
  }
  Logger.log('Таблица: ' + ss.getUrl());
  Logger.log('Ключ для админки: ' + cfg('ADMIN_KEY'));
}

/**
 * Лист из SHEETS. Если в таблице его ещё нет (новый лист вроде «Счета»),
 * заводится сам с заголовками - setupUchet для этого запускать не нужно.
 */
function sheetByName(name) {
  if (!SHEETS[name]) return null;
  var id = cfg('SHEET_ID');
  if (!id) return null;
  var ss = SpreadsheetApp.openById(id);
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Заголовки новых колонок: пустые ячейки первой строки дописываются по SHEETS.
 * Непустые не трогаем - если заголовок переименовали руками, это не наше дело:
 * колонки всё равно читаются по порядку.
 */
function ensureHead(sh, name) {
  var head = SHEETS[name];
  var cur = sh.getRange(1, 1, 1, head.length).getValues()[0];
  var fix = false;
  var row = head.map(function (h, i) {
    if (String(cur[i] === null ? '' : cur[i]).trim()) return cur[i];
    fix = true;
    return h;
  });
  if (fix) sh.getRange(1, 1, 1, head.length).setValues([row]).setFontWeight('bold');
}

function readSheet(name) {
  var sh = sheetByName(name);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var head = SHEETS[name];
  var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  return vals.filter(function (r) { return String(r[0] || '').length; })
             .map(function (r) {
    var o = {};
    head.forEach(function (h, i) {
      var v = r[i];
      o[h] = (v instanceof Date) ? Utilities.formatDate(v, 'Europe/Minsk', 'yyyy-MM-dd') : String(v === null ? '' : v);
    });
    return o;
  });
}

function allData() {
  var out = { sheets: {}, updated: new Date().toISOString() };
  Object.keys(SHEETS).forEach(function (n) { out.sheets[n] = readSheet(n); });
  return out;
}

function newId() {
  return Utilities.formatDate(new Date(), 'Europe/Minsk', 'yyMMddHHmmss') +
         Math.floor(Math.random() * 900 + 100);
}

function addRow(name, row) {
  var sh = sheetByName(name);
  if (!sh) throw new Error('нет листа ' + name);
  ensureHead(sh, name);
  var head = SHEETS[name];
  var id = row.id || newId();
  var line = head.map(function (h) { return h === 'id' ? id : (row[h] === undefined ? '' : row[h]); });
  sh.appendRow(line);
  return id;
}

function updateRow(name, id, patch) {
  var sh = sheetByName(name);
  if (!sh) throw new Error('нет листа ' + name);
  var head = SHEETS[name];
  var last = sh.getLastRow();
  if (last < 2) return false;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      var r = i + 2;
      head.forEach(function (h, c) {
        if (h !== 'id' && patch[h] !== undefined) sh.getRange(r, c + 1).setValue(patch[h]);
      });
      return true;
    }
  }
  return false;
}

function deleteRow(name, id) {
  var sh = sheetByName(name);
  if (!sh) return false;
  var last = sh.getLastRow();
  if (last < 2) return false;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) { sh.deleteRow(i + 2); return true; }
  }
  return false;
}

/* ——— Веб-приложение ——— */

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'data') {
    if (!cfg('ADMIN_KEY') || p.k !== cfg('ADMIN_KEY')) return json({ ok: false, error: 'ключ не подходит' });
    var d = allData();
    d.ok = true;
    return json(d);
  }
  // Воронка для страницы ассистента: только лиды и только чтение.
  // Подходит ключ Насти или ключ админки - вторым удобно проверять.
  if (p.action === 'leads') {
    var k = String(p.k || '');
    var ak = cfg('ASSIST_KEY'), dk = cfg('ADMIN_KEY');
    if (!(ak && k === ak) && !(dk && k === dk)) {
      return json({ ok: false, error: 'ключ не подходит' });
    }
    return json({ ok: true, leads: readSheet('Лиды') });
  }
  // Открытые задачи для страницы скрипта. Без ключа - по решению Артура,
  // страница публичная, значит и этот список публичный.
  // ?for=Настя отдаёт только её задачи и незакреплённые.
  if (p.action === 'tasks') {
    return json({ ok: true, tasks: openTasks(p['for']) });
  }
  return ContentService.createTextOutput('АртТич: приёмник записи пробного работает.');
}

/**
 * Открытые задачи. Если передан исполнитель - только его и те,
 * у кого исполнитель не проставлен: они общие и видны обоим.
 */
function openTasks(forWho) {
  var who = String(forWho || '').trim().toLowerCase();
  return readSheet('Задачи').filter(function (t) {
    if (String(t['сделано']).toLowerCase() === 'да') return false;
    if (!who) return true;
    var owner = String(t['исполнитель'] || '').trim().toLowerCase();
    return !owner || owner === who;
  });
}

/**
 * Задачи со страницы скрипта: добавить новую или отметить сделанной.
 * Удаления здесь нет намеренно - маршрут открытый, строку стереть нельзя.
 */
function taskPost(d) {
  if (d.op === 'done') {
    if (!d.id) return json({ ok: false, error: 'нет id' });
    var was = taskById(d.id);
    updateRow('Задачи', d.id, { 'сделано': 'да' });
    taskNote('Задача закрыта', was, d.from || 'Настя');
    return json({ ok: true, tasks: openTasks(d['for']) });
  }
  var what = String(d.what || '').trim();
  if (!what) return json({ ok: false, error: 'пустая задача' });
  var row = {
    'создана': Utilities.formatDate(new Date(), 'Europe/Minsk', 'yyyy-MM-dd'),
    'что':     what.slice(0, 300),
    'кого':    String(d.who || '').trim().slice(0, 100),
    'срок':    String(d.due || '').trim().slice(0, 20),
    'кто':     String(d.from || 'Настя').slice(0, 40),
    'сделано': 'нет',
    'текст':   String(d.text || '').slice(0, 2000),
    'исполнитель': String(d.to || '').trim().slice(0, 40)
  };
  addRow('Задачи', row);
  taskNote('Новая задача', row, row['кто']);
  return json({ ok: true, tasks: openTasks(d['for']) });
}

function taskById(id) {
  var list = readSheet('Задачи');
  for (var i = 0; i < list.length; i++) {
    if (String(list[i].id) === String(id)) return list[i];
  }
  return null;
}

/**
 * Уведомление в телеграм о том, что стало с задачей.
 * Только задачи Насти: остальное Артур видит в кабинете, телеграм им не засоряем.
 */
function taskNote(head, row, who) {
  if (!row) return;
  if (String(row['исполнитель'] || '').trim().toLowerCase() !== 'настя') return;
  var lines = [head, row['что'] || ''];
  if (row['кого']) lines.push('Кого: ' + row['кого']);
  if (row['срок']) lines.push('Срок: ' + row['срок']);
  if (row['исполнитель']) lines.push('Исполнитель: ' + row['исполнитель']);
  if (who) lines.push('Кто: ' + who);
  tgTasks(lines.join('\n'));
}

function doPost(e) {
  var d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) { d = {}; }

  if (d.action === 'admin') return adminPost(d);
  if (d.action === 'cancel') return cancelBooking(d);
  if (d.action === 'contact') return contactPost(d);
  if (d.action === 'task') return taskPost(d);
  return bookPost(d);
}

function adminPost(d) {
  if (!cfg('ADMIN_KEY') || d.k !== cfg('ADMIN_KEY')) return json({ ok: false, error: 'ключ не подходит' });
  try {
    if (d.op === 'add') {
      var newId = addRow(d.sheet, d.row || {});
      if (d.sheet === 'Задачи') taskNote('Новая задача', d.row || {}, (d.row || {})['кто'] || 'Артур');
      return json({ ok: true, id: newId });
    }
    if (d.op === 'update') {
      var before = d.sheet === 'Задачи' ? taskById(d.id) : null;
      var found = updateRow(d.sheet, d.id, d.row || {});
      if (before && String((d.row || {})['сделано']).toLowerCase() === 'да') {
        taskNote('Задача закрыта', before, 'Артур');
      }
      return json({ ok: true, found: found });
    }
    if (d.op === 'delete') {
      var gone = d.sheet === 'Задачи' ? taskById(d.id) : null;
      var removed = deleteRow(d.sheet, d.id);
      if (gone && removed) taskNote('Задача удалена', gone, 'Артур');
      return json({ ok: true, found: removed });
    }
    if (d.op === 'bulk') {
      var ids = (d.rows || []).map(function (r) { return addRow(d.sheet, r); });
      return json({ ok: true, ids: ids });
    }
    if (d.op === 'tg') return json(tgBatch(d));
    return json({ ok: false, error: 'неизвестная операция' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/**
 * Контакты родителя со страницы Насти: телеграм, вайбер, почта.
 * Пишутся в лист «Контакты» и дублируются в бот. Одно пробное - одна строка,
 * повторное сохранение обновляет её, а не плодит новые.
 */
function contactPost(d) {
  var key = '';
  if (d.start) {
    var t = new Date(d.start).getTime();
    if (!isNaN(t)) key = String(t);
  }
  var row = {
    'создан':   Utilities.formatDate(new Date(), 'Europe/Minsk', 'yyyy-MM-dd HH:mm'),
    'ник':      d.insta || '',
    'пробное':  d.when || '',
    'телеграм': d.tg || '',
    'вайбер':   d.viber || '',
    'почта':    d.mail || '',
    'ключ':     key
  };

  var done = false;
  if (key) {
    var list = readSheet('Контакты');
    for (var i = 0; i < list.length; i++) {
      if (String(list[i]['ключ']) === key) {
        updateRow('Контакты', list[i].id, row);
        done = true;
        break;
      }
    }
  }
  if (!done) addRow('Контакты', row);

  var lines = [];
  if (row['телеграм']) lines.push('Телеграм: ' + row['телеграм']);
  if (row['вайбер'])   lines.push('Вайбер: '   + row['вайбер']);
  if (row['почта'])    lines.push('Почта: '    + row['почта']);
  tg('Контакты для пробного\n' +
     'Instagram: ' + (d.insta || '-') + '\n' +
     'Когда: '     + (d.when  || '-') + '\n' +
     lines.join('\n'));

  return ContentService.createTextOutput('ok');
}

function bookPost(d) {
  var text = d.text || (
    'Пробное записано\n' +
    'Instagram: ' + (d.insta || '-') + '\n' +
    'Класс: '     + (d.klass || '-') + '\n' +
    'Когда: '     + (d.when  || '-') + '\n' +
    'Ссылка: '    + (d.link  || '-')
  );
  tg(text);

  if (d.start) {
    try {
      var ev = eventAt(d.start);
      if (ev && String(ev.getTitle() || '').toLowerCase().indexOf('своб') === 0) {
        ev.setTitle('Пробное: ' + (d.insta || '') + ' ' + (d.klass || ''));
        ev.setColor(CalendarApp.EventColor.MAUVE);
      }
    } catch (err2) {}
  }
  return ContentService.createTextOutput('ok');
}

function cancelBooking(d) {
  try {
    var ev = eventAt(d.start);
    if (ev) {
      ev.setTitle(FREE_TITLE);
      ev.setColor(CalendarApp.EventColor.YELLOW);
    }
  } catch (err) {}

  tg('Пробное отменено\n' +
     'Instagram: ' + (d.insta || '-') + '\n' +
     'Класс: '     + (d.klass || '-') + '\n' +
     'Когда: '     + (d.when  || '-') + '\n' +
     'Окно снова свободно.');

  return ContentService.createTextOutput('ok');
}

/* ——— Обслуживание ——— */

/** Разовая покраска: свободные окна жёлтые, записанные пробные фиолетовые. */
function paintAll() {
  var cal  = CalendarApp.getCalendarById(CAL_ID);
  var from = new Date();
  var till = new Date(from.getTime() + 120 * 24 * 3600 * 1000);
  var list = cal.getEvents(from, till);
  var free = 0, busy = 0;
  for (var i = 0; i < list.length; i++) {
    var t = String(list[i].getTitle() || '').toLowerCase();
    if (t.indexOf('своб') === 0) { list[i].setColor(CalendarApp.EventColor.YELLOW); free++; }
    else if (t.indexOf('пробное') === 0) { list[i].setColor(CalendarApp.EventColor.MAUVE); busy++; }
  }
  Logger.log('Покрашено: свободных ' + free + ', записанных ' + busy);
}

/**
 * Разовое заполнение: группы, ученики, оплаты и задачи по состоянию на сентябрь 2026.
 * Работает только если лист «Ученики» пуст, повторный запуск ничего не портит.
 */
function seed() {
  if (readSheet('Ученики').length) { Logger.log('Ученики уже заполнены, seed пропущен'); return; }

  var groups = [
    ['Мат6','математика','6','группа','суббота и воскресенье в 15:45','Артур',''],
    ['Мат7','математика','7','группа','суббота и воскресенье в 16:45 (сб алгебра, вс геометрия)','Артур',''],
    ['Мат8','математика','8','группа','вторник в 17:00 и суббота в 17:45','Артур',''],
    ['Мат9 (1)','математика','9','группа','вторник и четверг в 19:30','Артур',''],
    ['Мат9 (2)','математика','9','группа','среда и пятница в 18:15','Артур',''],
    ['Мат9 (3)','математика','9','группа','четверг в 17:00 и суббота в 19:00','Артур',''],
    ['Мат10 базовая','математика','10','группа','среда и пятница в 19:30','Артур',''],
    ['Мат10 профильная','математика','10','группа','вторник и четверг в 18:15','Артур',''],
    ['Мат11 ЦТ','математика','11','группа','вторник, четверг и пятница в 20:45','Артур',''],
    ['Хим8','химия','8','группа','воскресенье в 17:45','Артур','учеников пока нет'],
    ['Хим9','химия','9','группа','воскресенье в 19:00','Артур',''],
    ['Хим10','химия','10','группа','воскресенье в 20:15','Артур',''],
    ['Хим11','химия','11','группа','НЕ ЗАПОЛНЕНО','Артур','в расписании группы нет, но ученица есть']
  ];
  groups.forEach(function (g) {
    addRow('Группы', {'название':g[0],'предмет':g[1],'класс':g[2],'формат':g[3],'дни':g[4],'преподаватель':g[5],'заметка':g[6]});
  });

  var pupils = [
    ['Аня','6','математика','группа','Мат6','220','Маруся','сарафан',''],
    ['Назар','7','математика','группа','Мат7','210','Екатерина Демидович','реклама, сентябрь 2026',''],
    ['Роман','8','математика','группа','Мат8','260','Ирина Георгиевская','реклама, сентябрь 2026',''],
    ['Илья','9','математика','группа','Мат9 (3)','220','Алёна','','летом занимался индивидуально'],
    ['Катя Янута','9','математика','группа','Мат9 (2)','260','Виктория','реклама, 2025',''],
    ['Катя Балабина','9','математика','группа','Мат9 (2)','240','Ирина','','оплат нет'],
    ['Милана (9)','9','математика','группа','Мат9 (1)','220','Юлия','',''],
    ['Ярослав','9','математика','группа','Мат9 (1)','260','Надежда Штельман','реклама, сентябрь 2026',''],
    ['Прохор','9','математика, химия','группа','Мат9 (1) + Хим9','330','Илона','','330 за два предмета, оплат нет'],
    ['Ваня','10','математика','группа','Мат10 профильная','260','Ольга','реклама, 2025','к следующей оплате плюс 130 за 4 августовских занятия'],
    ['Наташа','10','математика','группа','Мат10 профильная','240','Ирина','',''],
    ['Фред','10','математика','группа','Мат10 профильная','220','Юлия','',''],
    ['Милана (10)','10','математика','группа','Мат10 базовая','220','Марина','сарафан','оплачено вперёд до декабря'],
    ['Сергей','10','математика','группа','Мат10 базовая','260','Наталья','реклама, сентябрь 2026',''],
    ['Кирилл','10','химия','группа','Хим10','110','Елена','',''],
    ['Егор','11','математика','группа','Мат11 ЦТ','300','Ольга','реклама, 2025','продление 240 со скидкой за дисциплину'],
    ['Лиана','11','математика','группа','Мат11 ЦТ','275','Людмила','','ЦЭ и ЦТ, продление 220'],
    ['Милена','11','химия','группа','нет в расписании','200','','','группы нет, родитель не записан']
  ];
  pupils.forEach(function (p) {
    addRow('Ученики', {
      'ученик':p[0],'класс':p[1],'предмет':p[2],'формат':p[3],'группа':p[4],
      'абонемент':p[5],'родитель':p[6],'источник':p[7],'статус':'учится','заметка':p[8]
    });
  });

  var pays = [
    ['Аня','сентябрь','52',''],
    ['Назар','сентябрь','105','первый абонемент со скидкой 50%'],
    ['Роман','сентябрь','130','первый абонемент со скидкой 50%'],
    ['Илья','июль-сентябрь','1120',''],
    ['Катя Янута','сентябрь','260',''],
    ['Милана (9)','август-сентябрь','275',''],
    ['Ярослав','сентябрь','130','первый абонемент со скидкой 50%'],
    ['Ваня','сентябрь','182',''],
    ['Наташа','сентябрь','240',''],
    ['Фред','сентябрь','220',''],
    ['Милана (10)','сентябрь-декабрь','770','оплачено вперёд за пять месяцев'],
    ['Сергей','сентябрь','130','первый абонемент со скидкой 50%'],
    ['Кирилл','сентябрь','110',''],
    ['Егор','сентябрь','480',''],
    ['Лиана','сентябрь','220',''],
    ['Милена','сентябрь','200','']
  ];
  pays.forEach(function (p) {
    addRow('Оплаты', {'дата':'','ученик':p[0],'месяц':p[1],'сумма':p[2],'чек':'','заметка':p[3] + (p[3] ? '; ' : '') + 'дата не уточнена'});
  });

  var tasks = [
    ['Взять оплату за сентябрь','Катя Балабина'],
    ['Взять оплату за сентябрь','Прохор'],
    ['Химия 11: группы в расписании нет, родитель не записан','Милена'],
    ['К следующей оплате добавить 130 за 4 августовских занятия','Ваня'],
    ['Уточнить оплату: 52 при абонементе 220','Аня']
  ];
  var d = Utilities.formatDate(new Date(), 'Europe/Minsk', 'yyyy-MM-dd');
  tasks.forEach(function (t) {
    addRow('Задачи', {'создана':d,'что':t[0],'кого':t[1],'срок':d,'кто':'Артур','сделано':'нет'});
  });

  Logger.log('Заполнено: групп ' + groups.length + ', учеников ' + pupils.length +
             ', оплат ' + pays.length + ', задач ' + tasks.length);
}

/** Показать адрес таблицы и ключ админки. */
function showSetup() {
  var id = cfg('SHEET_ID');
  Logger.log('Таблица: ' + (id ? SpreadsheetApp.openById(id).getUrl() : 'не создана, запустите setupUchet'));
  Logger.log('Ключ для админки: ' + (cfg('ADMIN_KEY') || 'нет, запустите setupUchet'));
}

/** Найти чат автоматически: напишите боту сообщение и запустите. */
function findChat() {
  var token = cfg('TG_TOKEN');
  if (!token) { Logger.log('Сначала заполните TG_TOKEN в свойствах скрипта'); return; }
  var me = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getMe',
                             { muteHttpExceptions: true }).getContentText();
  Logger.log('Бот: ' + me);
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates',
                              { muteHttpExceptions: true });
  var data = JSON.parse(res.getContentText());
  var list = data.result || [];
  if (!list.length) {
    Logger.log('Сообщений нет. Напишите боту, имя которого указано выше, и запустите ещё раз.');
    return;
  }
  var last = list[list.length - 1];
  var msg  = last.message || last.channel_post || last.my_chat_member || {};
  var chat = msg.chat || {};
  if (!chat.id) { Logger.log('Не нашёл чат: ' + JSON.stringify(last)); return; }
  props().setProperty('TG_CHAT', String(chat.id));
  Logger.log('Чат найден и сохранён: ' + chat.id + ' (' + (chat.title || chat.first_name || '') + ')');
  tg('Готово: бот будет присылать записи на пробное сюда.');
}

/** Разовая проверка связи с ботом. */
function testMessage() {
  Logger.log(tg('Проверка связи: скрипт АртТич подключён.'));
}

/* ——— Группа в телеграме ——— */

/** Все чаты, которые бот видел за последние сутки: личка, группы, темы. */
function listChats() {
  var token = cfg('TG_TOKEN');
  if (!token) { Logger.log('Сначала заполните TG_TOKEN в свойствах скрипта'); return; }
  var res  = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates',
                               { muteHttpExceptions: true });
  var list = (JSON.parse(res.getContentText()).result) || [];
  if (!list.length) {
    Logger.log('Сообщений нет. Напишите что-нибудь в группе и запустите ещё раз.');
    Logger.log('Сейчас в TG_CHAT: ' + (cfg('TG_CHAT') || 'пусто'));
    return;
  }
  var seen = {};
  list.forEach(function (u) {
    var msg  = u.message || u.channel_post || u.my_chat_member || u.edited_message || {};
    var chat = msg.chat;
    if (!chat) return;
    var key = String(chat.id) + (msg.message_thread_id ? ':' + msg.message_thread_id : '');
    if (seen[key]) return;
    seen[key] = true;
    Logger.log(chat.type + ' | ' + key + ' | ' + (chat.title || chat.first_name || ''));
  });
  Logger.log('Сейчас в TG_CHAT: ' + (cfg('TG_CHAT') || 'пусто'));
}

function pickGroup() {
  var token = cfg('TG_TOKEN');
  if (!token) { Logger.log('Сначала заполните TG_TOKEN в свойствах скрипта'); return null; }
  var res  = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates',
                               { muteHttpExceptions: true });
  var list = (JSON.parse(res.getContentText()).result) || [];
  var found = null;
  list.forEach(function (u) {
    var msg  = u.message || u.channel_post || u.my_chat_member || u.edited_message || {};
    var chat = msg.chat;
    if (chat && (chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel')) {
      found = {
        key: String(chat.id) + (msg.message_thread_id ? ':' + msg.message_thread_id : ''),
        title: chat.title || ''
      };
    }
  });
  if (!found) {
    Logger.log('Группу не нашёл. Добавьте бота в группу, напишите там любое сообщение и запустите ещё раз.');
  }
  return found;
}

/** Добавить группу к текущим адресатам: писать будет и в личку, и в группу. */
function addGroup() {
  var g = pickGroup();
  if (!g) return;
  var chats = tgChats();
  if (chats.indexOf(g.key) < 0) chats.push(g.key);
  props().setProperty('TG_CHAT', chats.join(','));
  Logger.log('Группа «' + g.title + '» добавлена. TG_CHAT: ' + chats.join(','));
  tg('Готово: записи на пробное будут приходить сюда.');
}

/** Слать только в группу: прежние адресаты заменяются. */
function useGroupOnly() {
  var g = pickGroup();
  if (!g) return;
  props().setProperty('TG_CHAT', g.key);
  Logger.log('Теперь пробные идут только в группу «' + g.title + '», TG_CHAT: ' + g.key);
  tg('Готово: записи на пробное будут приходить сюда.');
}

/**
 * Куда слать уведомления о задачах.
 * Напишите любое сообщение в нужный топик группы и запустите эту функцию.
 */
function setTasksTopic() {
  var token = cfg('TG_TOKEN');
  if (!token) { Logger.log('Сначала заполните TG_TOKEN в свойствах скрипта'); return; }
  var res  = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates',
                               { muteHttpExceptions: true });
  var list = (JSON.parse(res.getContentText()).result) || [];
  var found = null;
  list.forEach(function (u) {
    var msg  = u.message || u.edited_message || {};
    var chat = msg.chat;
    if (chat && msg.message_thread_id &&
        (chat.type === 'group' || chat.type === 'supergroup')) {
      found = { key: String(chat.id) + ':' + msg.message_thread_id, title: chat.title || '' };
    }
  });
  if (!found) {
    Logger.log('Топик не нашёл. Напишите сообщение в нужный топик и запустите ещё раз.');
    return;
  }
  props().setProperty('TG_TASKS', found.key);
  Logger.log('Уведомления о задачах уходят в «' + found.title + '», адрес ' + found.key);
  tgTasks('Готово: уведомления о задачах будут приходить сюда.');
}

/** Вернуть уведомления о задачах туда же, куда идут пробные. */
function clearTasksTopic() {
  props().deleteProperty('TG_TASKS');
  Logger.log('TG_TASKS очищен, задачи снова идут вместе с пробными.');
}

/* ════════════════ Проект «Домашние задания» ════════════════
 * После каждого проведённого занятия из календаря «(Артур) Основное расписание»
 * в листе «Задачи» появляется задача выслать ДЗ, с группой или учеником из базы.
 *
 * Как занятие узнаётся:
 *   1. по дню недели и времени начала - так оно записано у группы в колонке «дни»
 *      (у индивидуальных - в направлении ученика);
 *   2. если по времени не нашлось - по названию события («Группа Мат9 (2)» -> «Мат9 (2)»,
 *      «Варвара Хим10 Индив» -> ученица Варвара);
 *   3. не нашлось совсем - задача всё равно ставится, в «Кого» название события.
 * «Свободно» и события на весь день пропускаются.
 *
 * Запуск: hwInstall() один раз из редактора ставит hwTick каждые 10 минут.
 * hwCheck() ничего не пишет - только показывает в журнале, что было бы создано.
 */

var HW_CAL = 'c21b11fbb6772f6c2729e9c42722e8e8ce6a97f685dc28b5d4d4a4f0969e0075@group.calendar.google.com';
var HW_PROJECT = 'Домашние задания';
var HW_WHO = 'Артур';
var HW_CODES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function hwNorm(s) {
  return String(s === null || s === undefined ? '' : s).toLowerCase()
    .replace(/ё/g, 'е').replace(/^\s*группа\s+/, '').replace(/\s+/g, '');
}

/** «вт 18:15, чт 18:15» -> [{d:'вт', t:'18:15'}, ...] */
function hwDays(s) {
  var out = [];
  String(s || '').split(/[,;]/).forEach(function (part) {
    var m = String(part).trim().match(/^(пн|вт|ср|чт|пт|сб|вс)(?:\s+(\d{1,2})[:.](\d{2}))?$/i);
    if (!m) return;
    var t = m[2] ? ((m[2].length < 2 ? '0' : '') + m[2] + ':' + m[3]) : '';
    out.push({ d: m[1].toLowerCase(), t: t });
  });
  return out;
}

function hwFree(title) { return /^\s*свободн/i.test(String(title || '')); }

/** Похоже ли событие на занятие. Нужна, когда группу и ученика не нашли:
 *  «Индив ЦТ» - занятие, задачу ставим; личная встреча без этих слов - пропускаем. */
function hwLessonLike(title) {
  return /групп|индив|пара|мат|хим|алгебр|геометр|цт|цэ|урок|заняти/i.test(String(title || ''));
}

/**
 * Кого касается занятие. ev - {title, start: Date}.
 * Возвращает {kind: 'группа'|'ученик'|'', name, how}.
 */
function hwMatch(ev, groups, dirs) {
  var wd = HW_CODES[Number(Utilities.formatDate(ev.start, 'Europe/Minsk', 'u')) % 7];
  var hm = Utilities.formatDate(ev.start, 'Europe/Minsk', 'HH:mm');
  var title = hwNorm(ev.title);
  function atTime(days) {
    return hwDays(days).some(function (x) { return x.d === wd && x.t === hm; });
  }
  function byTitle(list, key) {
    var best = null, bestLen = 0;
    list.forEach(function (x) {
      var n = hwNorm(x[key]);
      if (!n) return;
      if ((title.indexOf(n) === 0 || n.indexOf(title) === 0) && n.length > bestLen) {
        best = x; bestLen = n.length;
      }
    });
    return best;
  }
  // 1. группа по времени; если в это время их несколько - уточняем названием
  var g = groups.filter(function (x) { return atTime(x['дни']); });
  if (g.length === 1) return { kind: 'группа', name: g[0]['название'], how: 'по времени' };
  if (g.length > 1) {
    var gg = byTitle(g, 'название');
    if (gg) return { kind: 'группа', name: gg['название'], how: 'по времени и названию' };
  }
  // 2. индивидуальное или пара по дням направления
  var d = dirs.filter(function (x) { return String(x['дни'] || '').trim() && atTime(x['дни']); });
  if (d.length === 1) return { kind: 'ученик', name: d[0]['ученик'], how: 'по времени' };
  // 3. по названию: сначала группы, потом ученики по имени в начале события
  var gt = byTitle(groups, 'название');
  if (gt) return { kind: 'группа', name: gt['название'], how: 'по названию' };
  var raw = String(ev.title || '').toLowerCase().replace(/ё/g, 'е').trim();
  var names = {};
  dirs.forEach(function (x) { names[x['ученик']] = true; });
  var who = Object.keys(names).filter(function (n) {
    var b = String(n).toLowerCase().replace(/ё/g, 'е').replace(/\s*\([^)]*\)\s*$/, '').trim();
    return b && (raw === b || raw.indexOf(b + ' ') === 0);
  });
  if (who.length === 1) return { kind: 'ученик', name: who[0], how: 'по имени' };
  return { kind: '', name: String(ev.title || '').trim(), how: 'не нашёл' };
}

/** Прошедшие занятия в окне [from, to): закончились внутри окна, не «Свободно», не на весь день. */
function hwLessons(from, to) {
  var cal = CalendarApp.getCalendarById(HW_CAL);
  if (!cal) throw new Error('нет доступа к календарю «Основное расписание»');
  var list = cal.getEvents(new Date(from.getTime() - 6 * 3600 * 1000), to);
  return list.filter(function (e) {
    if (e.isAllDayEvent() || hwFree(e.getTitle())) return false;
    var end = e.getEndTime().getTime();
    return end > from.getTime() && end <= to.getTime();
  }).map(function (e) {
    return { key: e.getId() + '|' + e.getStartTime().getTime(), title: e.getTitle(),
             start: e.getStartTime(), end: e.getEndTime() };
  });
}

function hwRow(ev, m) {
  var day = Utilities.formatDate(ev.start, 'Europe/Minsk', 'yyyy-MM-dd');
  var when = Utilities.formatDate(ev.start, 'Europe/Minsk', 'dd.MM HH:mm') + '-' +
             Utilities.formatDate(ev.end, 'Europe/Minsk', 'HH:mm');
  return {
    'создана': Utilities.formatDate(new Date(), 'Europe/Minsk', 'yyyy-MM-dd'),
    'что': 'Выслать ДЗ после занятия ' + when,
    'кого': m.name,
    'срок': day,
    'кто': 'календарь',
    'сделано': 'нет',
    'текст': 'В календаре: ' + String(ev.title || '').trim() +
             (m.kind ? '' : '. Группу или ученика в базе не нашёл - проверь название или дни в кабинете.'),
    'исполнитель': HW_WHO,
    'проект': HW_PROJECT,
    'ключ': ev.key
  };
}

function hwEnsureProject() {
  var has = readSheet('Проекты').some(function (p) {
    return String(p['название']).trim() === HW_PROJECT;
  });
  if (!has) addRow('Проекты', { 'название': HW_PROJECT,
    'заметка': 'задачи ставятся сами после каждого занятия из календаря' });
}

/** Основной запуск по таймеру. Окно - с прошлого запуска, не больше трёх суток. */
function hwTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return 'занято другим запуском';
  try {
    var now = new Date();
    var last = Number(cfg('HW_LAST')) || (now.getTime() - 3 * 3600 * 1000);
    var from = new Date(Math.max(last, now.getTime() - 3 * 24 * 3600 * 1000));
    var lessons = hwLessons(from, now);
    var made = 0;
    if (lessons.length) {
      hwEnsureProject();
      var seen = {};
      readSheet('Задачи').forEach(function (t) { if (t['ключ']) seen[t['ключ']] = true; });
      var groups = readSheet('Группы'), dirs = readSheet('Направления');
      lessons.forEach(function (ev) {
        if (seen[ev.key]) return;
        var m = hwMatch(ev, groups, dirs);
        if (!m.kind && !hwLessonLike(ev.title)) return;   // не занятие
        addRow('Задачи', hwRow(ev, m));
        seen[ev.key] = true;
        made++;
      });
    }
    props().setProperty('HW_LAST', String(now.getTime()));
    return 'занятий: ' + lessons.length + ', новых задач: ' + made;
  } finally {
    lock.releaseLock();
  }
}

/** Проверка без записи: что было бы создано за последние 7 дней. */
function hwCheck() {
  var now = new Date();
  var lessons = hwLessons(new Date(now.getTime() - 7 * 24 * 3600 * 1000), now);
  var groups = readSheet('Группы'), dirs = readSheet('Направления');
  Logger.log('Календарь открылся. Прошедших занятий за 7 дней: ' + lessons.length);
  lessons.forEach(function (ev) {
    var m = hwMatch(ev, groups, dirs);
    var res = m.kind ? m.kind + ' ' + m.name + '  (' + m.how + ')'
            : (hwLessonLike(ev.title) ? 'не нашёл, задача будет без группы' : 'не занятие, пропущу');
    Logger.log(Utilities.formatDate(ev.start, 'Europe/Minsk', 'EEE dd.MM HH:mm') + '  «' + ev.title + '»  ->  ' + res);
  });
}

/** Один раз из редактора: ставит hwTick каждые 10 минут, старые копии убирает. */
function hwInstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'hwTick') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('hwTick').timeBased().everyMinutes(10).create();
  props().setProperty('HW_LAST', String(new Date().getTime()));
  hwEnsureProject();
  Logger.log('Готово: задачи на ДЗ будут появляться в течение 10 минут после конца занятия.');
}

/** Выключить автозадачи. */
function hwStop() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'hwTick') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Автозадачи на ДЗ выключены.');
}
