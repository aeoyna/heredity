const http = require('http');

function post(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8787,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: JSON.parse(data)
        });
      });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

async function run() {
  try {
    console.log('1. Anonymous Auth...');
    const authRes = await post('/api/auth/anonymous', {});
    console.log('Auth Status:', authRes.status);
    console.log('Auth Headers:', authRes.headers);
    
    const setCookie = authRes.headers['set-cookie'];
    if (!setCookie) {
      throw new Error('No Set-Cookie header returned');
    }
    const token = setCookie[0].split(';')[0];
    const headers = { 'Cookie': token };
    console.log('Token Cookie:', token);

    console.log('\n2. Creating Thread...');
    const createRes = await post('/api/threads', {
      name: 'test-node-delete',
      type: 'line',
      lineCount: 5
    }, headers);
    console.log('Create Status:', createRes.status);
    console.log('Create Body:', createRes.body);

    const threadId = createRes.body?.thread?.id;
    if (!threadId) {
      throw new Error('Failed to create thread, thread.id is missing');
    }

    console.log('\n3. Deleting Thread:', threadId);
    const deleteRes = await post('/api/threads/delete', {
      thread_id: threadId
    }, headers);
    console.log('Delete Status:', deleteRes.status);
    console.log('Delete Body:', deleteRes.body);

  } catch (err) {
    console.error('Error in test:', err);
  }
}

run();
