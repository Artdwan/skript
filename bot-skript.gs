/**
 * АртТич - запись пробного.
 * Принимает данные со страницы скрипта, отправляет их в Telegram
 * и переименовывает окно в календаре, чтобы оно ушло из свободных.
 *
 * Заполните три строки ниже, потом Развернуть - Новое развёртывание -
 * Веб-приложение, запуск от своего имени, доступ "Все".
 */

var TOKEN   = 'ВСТАВЬТЕ_ТОКЕН_ОТ_BOTFATHER';
var CHAT_ID = 'ВСТАВЬТЕ_ID_ЧАТА';
var CAL_ID  = 'b43eb3d7776bfcea6809d656966accc9e36cc6cdcf0ea8b0c5b093a514086e67@group.calendar.google.com';

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

  UrlFetchApp.fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
    method: 'post',
    payload: {
      chat_id: CHAT_ID,
      text: text,
      disable_web_page_preview: 'true'
    },
    muteHttpExceptions: true
  });

  if (d.start) {
    try {
      var cal   = CalendarApp.getCalendarById(CAL_ID);
      var start = new Date(d.start);
      var list  = cal.getEvents(new Date(start.getTime() - 60000),
                                new Date(start.getTime() + 60000));
      for (var i = 0; i < list.length; i++) {
        var title = list[i].getTitle() || '';
        if (title.toLowerCase().indexOf('своб') === 0) {
          list[i].setTitle('Пробное: ' + (d.insta || '') + ' ' + (d.klass || ''));
          break;
        }
      }
    } catch (err2) {}
  }

  return ContentService.createTextOutput('ok');
}

/** Разовая проверка: запустите эту функцию, чтобы убедиться, что бот пишет в нужный чат. */
function testMessage() {
  UrlFetchApp.fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
    method: 'post',
    payload: { chat_id: CHAT_ID, text: 'Проверка связи: скрипт АртТич подключён.' },
    muteHttpExceptions: true
  });
}
