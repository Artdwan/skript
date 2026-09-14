/**
 * АртТич - запись пробного.
 * Токен и чат хранятся в свойствах скрипта: TG_TOKEN и TG_CHAT.
 *
 * Цвета в календаре: жёлтый - окно свободно, фиолетовый - на окно записано пробное.
 */

var CAL_ID = 'b43eb3d7776bfcea6809d656966accc9e36cc6cdcf0ea8b0c5b093a514086e67@group.calendar.google.com';
var FREE_TITLE = 'Свободно для пробного';

function cfg(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

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

/** Найти событие календаря, которое начинается в указанное время. */
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

function doPost(e) {
  var d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) { d = {}; }

  if (d.action === 'cancel') return cancelBooking(d);

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
        ev.setColor(CalendarApp.EventColor.MAUVE);   // фиолетовый
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
      ev.setColor(CalendarApp.EventColor.YELLOW);    // жёлтый
    }
  } catch (err) {}

  tg('Пробное отменено\n' +
     'Instagram: ' + (d.insta || '-') + '\n' +
     'Класс: '     + (d.klass || '-') + '\n' +
     'Когда: '     + (d.when  || '-') + '\n' +
     'Окно снова свободно.');

  return ContentService.createTextOutput('ok');
}

function doGet() {
  return ContentService.createTextOutput('АртТич: приёмник записи пробного работает.');
}

/**
 * Разовая покраска: все будущие окна в календаре получают правильный цвет.
 * Свободные - жёлтые, записанные пробные - фиолетовые.
 */
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
 * Найти чат автоматически. Напишите боту любое сообщение в Telegram,
 * потом запустите эту функцию - она сама запишет id в свойство TG_CHAT.
 */
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
  PropertiesService.getScriptProperties().setProperty('TG_CHAT', String(chat.id));
  Logger.log('Чат найден и сохранён: ' + chat.id + ' (' + (chat.title || chat.first_name || '') + ')');
  tg('Готово: бот будет присылать записи на пробное сюда.');
}

/** Разовая проверка: запустите, чтобы убедиться, что бот пишет в нужный чат. */
function testMessage() {
  Logger.log(tg('Проверка связи: скрипт АртТич подключён.'));
}
