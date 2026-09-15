/**
 * АртТич - приёмник записи пробного и шлюз к таблице учёта.
 *
 * Свойства скрипта (Настройки проекта - Свойства скрипта):
 *   TG_TOKEN  - токен бота от BotFather
 *   TG_CHAT   - куда слать: findChat (личка), addGroup или useGroupOnly (группа).
 *               Можно несколько через запятую; тема форума пишется «id_чата:id_темы».
 *   SHEET_ID  - id таблицы учёта, заполняется функцией setupUchet
 *   ADMIN_KEY - ключ доступа к админке, создаётся функцией setupUchet
 *
 * Цвета в календаре: жёлтый - окно свободно, фиолетовый - записано пробное.
 */

var CAL_ID = 'b43eb3d7776bfcea6809d656966accc9e36cc6cdcf0ea8b0c5b093a514086e67@group.calendar.google.com';
var FREE_TITLE = 'Свободно для пробного';

var SHEETS = {
  'Лиды':    ['id','дата','ник','родитель','класс','предмет','цель','статус','предложили','пробное','след_шаг','след_дата','источник','заметка','этап','ход','обновлён','причина'],
  'Группы':  ['id','название','предмет','класс','формат','дни','преподаватель','заметка'],
  'Ученики': ['id','ученик','класс','предмет','формат','группа','абонемент','родитель','источник','старт','discord','holst','статус','заметка'],
  'Оплаты':  ['id','дата','ученик','месяц','сумма','чек','заметка'],
  'Задачи':  ['id','создана','что','кого','срок','кто','сделано'],
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

function tg(text) {
  var token = cfg('TG_TOKEN');
  var chats = tgChats();
  if (!token || !chats.length) return 'нет TG_TOKEN или TG_CHAT в свойствах скрипта';
  var out = [];
  chats.forEach(function (chat) {
    var payload = { chat_id: chat, text: text, disable_web_page_preview: 'true' };
    var parts = String(chat).split(':');
    if (parts.length === 2) { payload.chat_id = parts[0]; payload.message_thread_id = parts[1]; }
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      payload: payload,
      muteHttpExceptions: true
    });
    out.push(chat + ' -> ' + res.getContentText());
  });
  return out.join('\n');
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
  if (d.action === 'contact') return contactPost(d);
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
