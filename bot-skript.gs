/**
 * АртТич - запись пробного.
 * Принимает данные со страницы скрипта, отправляет их в Telegram
 * и переименовывает окно в календаре, чтобы оно ушло из свободных.
 *
 * Токен и чат НЕ в коде. Настройки проекта - Свойства скрипта:
 *   TG_TOKEN - токен от BotFather
 *   TG_CHAT  - id чата или группы
 */

var CAL_ID = 'b43eb3d7776bfcea6809d656966accc9e36cc6cdcf0ea8b0c5b093a514086e67@group.calendar.google.com';

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

function doPost(e) {
  var d = {};
  try { d = JSON.parse(e.postData.contents); } catch (err) { d = {}; }

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
      var cal   = CalendarApp.getCalendarById(CAL_ID);
      var start = new Date(d.start);
      var list  = cal.getEvents(new Date(start.getTime() - 60000),
                                new Date(start.getTime() + 60000));
      for (var i = 0; i < list.length; i++) {
        var title = String(list[i].getTitle() || '');
        if (title.toLowerCase().indexOf('своб') === 0) {
          list[i].setTitle('Пробное: ' + (d.insta || '') + ' ' + (d.klass || ''));
          break;
        }
      }
    } catch (err2) {}
  }

  return ContentService.createTextOutput('ok');
}

function doGet() {
  return ContentService.createTextOutput('АртТич: приёмник записи пробного работает.');
}

/** Разовая проверка: запустите, чтобы убедиться, что бот пишет в нужный чат. */
function testMessage() {
  Logger.log(tg('Проверка связи: скрипт АртТич подключён.'));
}
