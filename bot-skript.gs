/**
 * АртТич - приёмник записи пробного и шлюз к таблице учёта.
 *
 * Свойства скрипта (Настройки проекта - Свойства скрипта):
 *   TG_TOKEN  - токен бота от BotFather
 *   TG_CHAT   - id чата, заполняется функцией findChat
 *   SHEET_ID  - id таблицы учёта, заполняется функцией setupUchet
 *   ADMIN_KEY - ключ доступа к админке, создаётся функцией setupUchet
 *
 * Цвета в календаре: жёлтый - окно свободно, фиолетовый - записано пробное.
 */

var CAL_ID = 'b43eb3d7776bfcea6809d656966accc9e36cc6cdcf0ea8b0c5b093a514086e67@group.calendar.google.com';
var FREE_TITLE = 'Свободно для пробного';

var SHEETS = {
  'Лиды':    ['id','дата','ник','родитель','класс','предмет','цель','статус','предложили','пробное','след_шаг','след_дата','источник','заметка'],
  'Ученики': ['id','ученик','класс','предмет','формат','группа','преподаватель','ник','старт','discord','holst','статус','заметка'],
  'Оплаты':  ['id','дата','ученик','месяц','сумма','скидка','чек','заметка'],
  'Задачи':  ['id','создана','что','кого','срок','кто','сделано']
};

function props() { return PropertiesService.getScriptProperties(); }
function cfg(key) { return props().getProperty(key) || ''; }

/* ——— Telegram ——— */

function tg(text) {
  var token = cfg('TG_TOKEN');
  var chat  = cfg('TG_CHAT');
  if (!token || !chat) return 'нет TG_TOKEN или TG_CHAT в свойствах скрипта';
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    payload: { chat_id: chat, text: text, disable_web_page_preview: 'true' },
    muteHttpExceptions: true
  });
  return res.getContentText();
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

function sheetByName(name) {
  if (!SHEETS[name]) return null;
  var id = cfg('SHEET_ID');
  if (!id) return null;
  return SpreadsheetApp.openById(id).getSheetByName(name);
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
  return ContentService.createTextOutput('АртТич: приёмник записи пробного работает.');
}

function doPost(e) {
  var d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) { d = {}; }

  if (d.action === 'admin') return adminPost(d);
  if (d.action === 'cancel') return cancelBooking(d);
  return bookPost(d);
}

function adminPost(d) {
  if (!cfg('ADMIN_KEY') || d.k !== cfg('ADMIN_KEY')) return json({ ok: false, error: 'ключ не подходит' });
  try {
    if (d.op === 'add')    return json({ ok: true, id: addRow(d.sheet, d.row || {}) });
    if (d.op === 'update') return json({ ok: true, found: updateRow(d.sheet, d.id, d.row || {}) });
    if (d.op === 'delete') return json({ ok: true, found: deleteRow(d.sheet, d.id) });
    if (d.op === 'bulk') {
      var ids = (d.rows || []).map(function (r) { return addRow(d.sheet, r); });
      return json({ ok: true, ids: ids });
    }
    return json({ ok: false, error: 'неизвестная операция' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
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
