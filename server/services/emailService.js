
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL;
const CRAV_SECRET = process.env.CRAV_SECRET;

async function sendOtpEmail(email, otp, firstName = 'Food Lover') {
  if (!GOOGLE_SCRIPT_URL) {
    throw new Error('GOOGLE_APPS_SCRIPT_URL is missing.');
  }

  if (!CRAV_SECRET) {
    throw new Error('CRAV_SECRET is missing.');
  }

  try {
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        secret: CRAV_SECRET,
        email,
        otp,
        firstName
      }),
      signal: AbortSignal.timeout(30000)
    });

    const responseText = await response.text();

    let result;

    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error('Google Apps Script returned an invalid response.');
    }

    if (!response.ok || !result.success) {
      throw new Error(
        result.message || `Google email service failed: ${response.status}`
      );
    }

    console.log('CRAV OTP email accepted by Google Apps Script.');

    return {
      success: true,
      delivered: true
    };

  } catch (error) {
    console.error('CRAV GOOGLE EMAIL ERROR:', error.message);
    throw error;
  }
}

module.exports = {
  sendOtpEmail
};
