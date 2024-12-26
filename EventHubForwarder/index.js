'use strict';

import https from 'https';

const LAST9_USERNAME = process.env.LAST9_USERNAME;
const LAST9_PASSWORD = process.env.LAST9_PASSWORD;
const LAST9_TAGS = process.env.LAST9_TAGS; // comma-seperated tags
const LAST9_ENDPOINT =
  process.env.LAST9_ENDPOINT || 'https://otlp.last9.com/jsonlines/v2' +
  (LAST9_TAGS ? '?' + LAST9_TAGS.split(',').join('&') : '');
const MAX_RETRIES = process.env.MAX_RETRIES || 3;
const RETRY_INTERVAL = process.env.RETRY_INTERVAL || 2000; // default: 2 seconds

export default async function main(context, logMessages) {
  if (!LAST9_USERNAME && !LAST9_PASSWORD) {
    context.log.error(
      'You have to configure LAST9_USERNAME and LAST9_PASSWORD.'
    );
    return;
  }
  let logs;
  if (typeof logMessages === 'string') {
    logs = logMessages.trim().split('\n');
  } else if (Buffer.isBuffer(logMessages)) {
    logs = logMessages.toString('utf8').trim().split('\n');
  } else if (!Array.isArray(logMessages)) {
    logs = JSON.stringify(logMessages).trim().split('\n');
  } else {
    logs = logMessages;
  }
  context.log.info(`Received ${logs.length} logs`);
  await compressAndSend(logs, context);
};

async function sendLogs(data, context) {
  try {
    await retryMax(httpSend, MAX_RETRIES, RETRY_INTERVAL, [data, context]);
    context.log('Logs payload successfully sent to Last9.');
  } catch (e) {
    context.log.error('Max retries reached: failed to send logs payload to Last9');
    context.log.error('Exception: ', JSON.stringify(e));
  }
}

function httpSend(data, context) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(LAST9_ENDPOINT);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      protocol: urlObj.protocol,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(LAST9_USERNAME + ':' + LAST9_PASSWORD).toString('base64')}`
      },
    };

    var req = https.request(options, (res) => {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk; // don't really do anything with body
      });
      res.on('end', () => {
        context.log('Got response:' + res.statusCode);
        if (res.statusCode === 202) {
          resolve(body);
        } else {
          reject({ error: null, res: res });
        }
      });
    });

    req.on('error', (e) => {
      reject({ error: e, res: null });
    });
    req.write(data);
    req.end();
  });
}

function retryMax(fn, retry, interval, fnParams) {
  return fn.apply(this, fnParams).catch((err) => {
    return retry > 1
      ? wait(interval).then(() => retryMax(fn, retry - 1, interval, fnParams))
      : Promise.reject(err);
  });
}

function wait(delay) {
  return new Promise((fulfill) => {
    setTimeout(fulfill, delay || 0);
  });
}
