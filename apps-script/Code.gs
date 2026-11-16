function doPost(e) {
  var properties = PropertiesService.getScriptProperties();
  var expectedToken = properties.getProperty('MOODTUNES_TOKEN') || '';

  try {
    var data = JSON.parse(e && e.postData ? e.postData.contents : '{}');
    if (!expectedToken || !data.token || data.token !== expectedToken) {
      return respond({ success: false, error: 'No autorizado.' });
    }

    var email = String(data.destino || '').trim();
    var code = String(data.codigo || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
      return respond({ success: false, error: 'Solicitud no válida.' });
    }

    var accountType = data.tipo === 'admin' ? 'panel de administracion' : 'cuenta MoodTunes';
    var body = 'Tu codigo para recuperar el acceso a tu ' + accountType + ' es: ' + code +
      '\n\nVence en 15 minutos y solo se puede usar una vez. Si no solicitaste este codigo, ignora este mensaje.';
    MailApp.sendEmail(email, 'MoodTunes - Codigo para recuperar tu acceso', body, {
      name: 'MoodTunes'
    });
    return respond({ success: true });
  } catch (error) {
    console.error('Fallo al procesar solicitud de correo.');
    return respond({ success: false, error: 'No se pudo enviar el correo.' });
  }
}

function autorizarGmail() {
  MailApp.getRemainingDailyQuota();
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
