var http = require('http'),
    util = require('util'),
 	fs = require('fs'),
  YAML = require('yamlparser'),
 	qs = require('qs'),
    formidable = require('formidable'),
    knox = require('knox'),
 	exec = require('child_process').exec,
 	app = require('express').createServer(),
  os = require('os'),
//   v8p = require('v8-profiler'),
  net = require('net'),
  microtime = require('microtime'),
    server;

var LOCALHOST = 'localhost.com';
var PORT      = 3003;

function S4() {
  return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
}
function generate_uuid() {
  return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
}

/* dump errors */
function dumpError(err) {
  if (typeof err === 'object') {
    if (err.message) {
      console.log('\nMessage: ' + err.message)
    }
    if (err.stack) {
      console.log('\nStacktrace:')
      console.log('====================')
      console.log(err.stack);
    }
  } else {
    console.log('dumpError :: argument is not an object');
  }
}


app.get('/', function(req, res) {
	console.log("works!")
    res.writeHead(200, {'content-type': 'text/html'});
    res.end(
      '<form action="/v1/upload" enctype="multipart/form-data" method="post">'+
      '<input type="text" name="photo[name]"><br>'+
      '<input type="file" name="photo[image]" multiple="multiple"><br>'+
      '<input type="submit" value="Upload">'+
      '</form>'
    );
});

app.post('/v1/upload', function(req, res) {
	
  // no timeout
  req.connection.setTimeout(0);
  var start = microtime.now();
  var form = new formidable.IncomingForm();
  var env = {};
  env['uuid'] = generate_uuid();
  env['req'] = req;
  env['res'] = res;
  env['event_queue'] = {};
  env['fields'] = [];
  env['buffer'] = new Buffer(8);
  env['bufpos'] = 0;
  env['async_body'] = '';
	

	
	form.on('field', function(field, value) {
    console.log(env['uuid'] + " " + field + " => " + value);
    env['fields'].push([field, value]);
  });
  form.on('end', function() {
    console.log('on end');
    res.writeHead(200, {'Content-Type':'image/jpeg','Content-Transfer-Encoding':'binary',
      "Content-Disposition": "attachment; filename=\"test.jpg\";",
      "Content-Length":env['async_body'].length
      // "Content-Length":env['buffer'].length
    });
    res.end(env['async_body']);
    // res.writeHead(200, {'Content-Type':'text/html'});
    // res.write('<html><body><img src="data:image/jpeg;base64,')
    // res.write(new Buffer(env['async_body']).toString('base64'));
    // res.end('"/><</body></html>');
  });

	form.on('error', function(err) {
		console.log(err)
		 res.writeHead(500,{})
		 res.end("")
      });
	form.on('abort', function() {
		console.log("abort")
		 res.writeHead(500,{})
		 res.end("")
      });

	form.onPart = function(part) {
  		if (!part.filename) {
    		// let formidable handle all non-file parts
    		form.handlePart(part);
  		}else{
			part.addListener('data', function(data) {
				console.log(env['uuid'] + " receiving " + data.length + " bytes of " + part.filename + " total received: "+ form.bytesReceived + " total expected: "+ form.bytesExpected  );
			
				// Pause receiving request data (until current chunk is written)
				req.pause();
				console.log(env['uuid'] + " request paused " );
        env['async_body'] += data;
        // console.log(data);
        // env['buffer'].write(data, env['bufpos'], 'binary');
        // env['bufpos'] += Buffer.byteLength(data);
				console.log(env['uuid'] + " write triggered "   );
        req.resume();
			});
		}
	}
    form.parse(req);

  finish = microtime.now();
  bmark_time = finish - start;
  console.log('full process time: ' + bmark_time);

});

app.listen(PORT, function() {
  console.log('listening on http://'+LOCALHOST+':'+PORT+'/');
});

