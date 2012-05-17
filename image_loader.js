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
  microtime = require('microtime'),
    server;

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

try {
  var data = fs.readFileSync('config.yaml', 'ascii');
  console.log(data);
}
catch (err) {
  console.error("You need a config.yaml file with API_URL and API_PORT defined.");
  console.log(err);
}

var config = YAML.eval(data);
console.log(config);
var API_URL  = config['API_URL'];
var API_PORT = config['API_PORT'];

// TODO: abstract hardcoded vars into a yaml / config file
var PORT = process.env.PORT || 3003;	
var TMP = "/tmp";
var BUCKET = "com.picbounce.incoming"
var LOCALHOST = os.hostname();
var image_convert_styles = [
	{"style" : "s600x600", "options": '-define jpeg: -resize "600x600^" -gravity center -crop 600x600+0+0 -auto-orient -quality 90'},
]
var required_fields = ["key"]


function EncodeFieldPart(boundary,name,value) {
  var return_part = "--" + boundary + "\r\n";
  return_part += "Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n";
  return_part += value + "\r\n";
  return return_part;
}

function EncodeFilePart(boundary,type,name,filename) {
  var return_part = "--" + boundary + "\r\n";
  return_part += "Content-Disposition: form-data; name=\"" + name + "\"; filename=\"" + filename + "\"\r\n";
  return_part += "Content-Type: " + type + "\r\n\r\n";
  return return_part;
}

function makePost(post_data, boundary, env) {

  var length = 0;

  for(var i = 0; i < post_data.length; i++) {
    length += post_data[i].length;
  }

  var post_options = {
    host: 'localhost.com',
    port: '3000',
    path: '/photos',
    method: 'POST',
    headers : {
        'Content-Type' : 'multipart/form-data; boundary=' + boundary,
        'Content-Length' : length
    }
  };

  var post_request = http.request(post_options, function(response){
    response.setEncoding('utf8');
    response.on('data', function(chunk){
      console.log('chunk');
      console.log(chunk);
      env['chunk'] = chunk;
    });
  });

  for (var i = 0; i < post_data.length; i++) {
    post_request.write(post_data[i]);
  }
  post_request.end();
}


function preparePost(env) {
  var boundary = Math.random();
  var post_data = [];

  post_data.push(new Buffer(EncodeFieldPart(boundary, 'photo[name]', env['uuid']+'.jpg'), 'ascii'));
  post_data.push(new Buffer(EncodeFilePart(boundary, 'image/jpeg', 'photo[image]', env['uuid'] + '.jpg'), 'ascii'));

  var file_reader = fs.createReadStream(TMP + '/' + env['uuid'], {encoding: 'binary'});
  var file_contents = '';
  file_reader.on('data', function(data){
    file_contents += data;
  });
  file_reader.on('end', function(){
    post_data.push(new Buffer(file_contents, 'binary'))
    post_data.push(new Buffer("\r\n--" + boundary + "--"), 'ascii');

    console.log('calling makePost');
    makePost(post_data, boundary, env);
    console.log('end of makePost');
  });
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
  start = microtime.now();

	var env = {}
  env['uuid'] = generate_uuid();
	env['req'] = req;
	env['res'] = res;
	env['event_queue'] = {};
	env['fields'] =	[]
  var form = new formidable.IncomingForm();
	
  //prepare disk write
  var fileStream = fs.createWriteStream(TMP+"/"+env['uuid'])
    fileStream.addListener("error", function(err) {
        console.log("Got error while writing to file '" + env['uuid'] + "': ", err);
    });
    fileStream.addListener("drain", function() {
    console.log(env['uuid'] + " request resuming " );
        req.resume();
    console.log(env['uuid'] + " request resumed " );
    });

	
	form.on('field', function(field, value) {
        console.log(env['uuid'] + " " + field + " => " + value);
        env['fields'].push([field, value]);
  });
  form.on('end', function() {
		fileStream.addListener("drain", function() {
			 console.log(env['uuid'] + ' save completing');
			 req.resume();
		   fileStream.end();
       // post to form here 
       preparePost(env);
       console.log('end of preparePost');
       res.end(env['chunk']);
		});
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
				fileStream.write(data, "binary");
				console.log(env['uuid'] + " write triggered "   );
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

