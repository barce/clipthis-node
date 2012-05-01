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
  v8p = require('v8-profiler'),
  microtime = require('microtime'),
    server;


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
	{"style" : "s150x150", "options": '-define jpeg: -resize "150x150^" -gravity center -crop 150x150+0+0 -auto-orient -quality 90'},
	{"style" : "s600x600", "options": '-define jpeg: -resize "600x600^" -gravity center -crop 600x600+0+0 -auto-orient -quality 90'},
	{"style" : "r600x600", "options" : '-resize "600x600>" -auto-orient'},
]
var required_fields = ["key"]



function on_header_receive(env){
	console.log(env['uuid'] + ' received headers');
	var headers = {
		'x-verify-credentials-authorization': env['req'].headers['x-verify-credentials-authorization'],
		'x-auth-service-provider': env['req'].headers['x-auth-service-provider'],
	}
	var options = {
		host: API_URL,
    port: API_PORT,
		path: '/api/v1/posts/oauth_echo',
		headers: headers,
		method: 'POST',
	}
	var auth_req = http.request(options, function(res) {
		console.log("sent")
		trigger_local_event(env,"header_verification","complete");
	});
	auth_req.write("")
	auth_req.end()
	
	console.log(env['req'].headers['x-verify-credentials-authorization'])
	console.log(env['req'].headers['x-auth-service-provider'])
}

function on_save_complete(env){
	console.log(env['uuid'] + ' save complete');
	for (var i in image_convert_styles){
		convert(env['uuid'],image_convert_styles[i]["style"],image_convert_styles[i]["options"],convert_callback(env, image_convert_styles[i]["style"]))
	}
}
function on_header_verified(env){

  start = microtime.now();

  console.log('---fields---');
  console.log(env['fields']);
  console.log('---fields---');
  console.log('---key & text---');
  try { 
    console.log(env['fields'][0][1]); 
  } catch(err) {
    dumpError(err);
  }

  try { 
    console.log(env['fields'][1][1]);
  } catch(err) {
    dumpError(err);
  }
  console.log('---key & text---');

  try {
    var s_key = env['fields'][1][1];
  } catch(err) {
    dumpError(err);
  }

  try {
    var s_text = env['fields'][0][1];
  } catch(err) {
    dumpError(err);
  }

	var data = {
    // media_type can also be video
		"media_type":"photo",
		"media_url": "http://"+BUCKET+".s3.amazonaws.com/"+env['uuid']+"/r600x600.jpg",
    "key":s_key,
    "text":s_text
	}

  var s_length = qs.stringify(data).length
  if (API_URL == 'localhost.com') {
		var headers = {
			'x-verify-credentials-authorization': env['req'].headers['x-verify-credentials-authorization'],
			'x-auth-service-provider': env['req'].headers['x-auth-service-provider'],
	    'Content-length': s_length,
	    // 'Transfer-Encoding': 'gzip'
		}
  } else {
		var headers = {
			'x-verify-credentials-authorization': env['req'].headers['x-verify-credentials-authorization'],
			'x-auth-service-provider': env['req'].headers['x-auth-service-provider'],
    }
  }
	var options = {
		host: API_URL,
    port: API_PORT,
		path: '/api/v1/posts/oauth_echo',
		headers: headers,
		method: 'POST'
	}
  // get content-length of data
  // transfer encoding gzip
	var post_req = http.request(options, function(res) {
    req_start = microtime.now();
		console.log("sending...")
		console.log("---options---")
    console.log(options);
		console.log("---options---")
		console.log("sent")
    console.log("status code:");
		console.log(res.statusCode)
		env["async_res"] = res
		env["async_body"] = ""

    console.log('---data---');
    console.log(data);
    console.log('---data---');

		res.on('data', function(chunk) {
		    console.log("Body chunk: " + chunk);
			env["async_body"] += chunk
		});
    
    req_finish = microtime.now();
    req_bmark  = req_finish - req_start;
    console.log('http request microtime: ' + req_bmark);
		trigger_local_event(env,"data_posted","complete");
	});
	post_req.write(qs.stringify(data));
	post_req.end();
  finish = microtime.now();
  bmark_time = finish - start;
  console.log('data posted time: ' + bmark_time);
	
}

function on_convert_complete(env){
	console.log(env['uuid'] + ' returning response');
	

	fs.unlink(TMP+"/"+env['uuid'], function (err) {
	  if (err) throw err;
	  console.log('successfully deleted' + TMP+"/"+env['uuid']);
	
	  env['res'].writeHead(env['async_res'].statusCode, env['async_res'].headers);
	  env['res'].write(env["async_body"])
	  env['res'].end();
	});
}
function convert_callback(env,style){
	return  function(error, stdout, stderr){
		
		var s3Client =	knox.createClient({
		    key: ''
		  , secret: ''
		  , bucket: BUCKET
		});
		
		console.log(env['uuid'] + " converting to " +TMP+"/"+env['uuid']+"-"+style+".jpg" + " complete ")
		console.log(env['uuid'] + ' upload to s3 started');
		var stream = fs.createReadStream(TMP+"/"+env['uuid']+"-"+style+".jpg");
		s3Client.putStream(stream, env['uuid']+"/"+style+".jpg", function(err, result){
			console.log(env['uuid'] + ' '+style+' upload to s3 complete');
			trigger_local_event(env,style,"complete");
			fs.unlink(TMP+"/"+env['uuid']+"-"+style+".jpg", function (err) {
			  if (err) throw err;
			  console.log('successfully deleted ' + TMP+"/"+env['uuid']+"-"+style+".jpg");
			});
		});
	}
	
}

function convert(uuid,style,options,callback){
	var input_path = TMP+"/"+uuid
	var output_path = TMP+"/"+uuid + "-" +style +".jpg"
	exec("convert " + input_path + " " +options + " " + output_path , callback);
	console.log("converting  " +output_path + " triggered ")
	return output_path
}

function trigger_local_event(env,key,result){
	env['event_queue'][key] = result;
  console.log('--event_queue---');
	console.log(env['event_queue']);
  console.log('--event_queue---');
	var all_converts_complete = true;
	for (var i in  image_convert_styles){
		all_converts_complete = all_converts_complete && env['event_queue'][image_convert_styles[i]["style"]] == "complete"
	}
	if (env['event_queue']["r600x600"] == "complete" && env['event_queue']["header_verification"] == "complete" && env['event_queue']["on_header_verified"] == null){
		env['event_queue']["on_header_verified"] = "started"
		on_header_verified(env)
		env['event_queue']["on_header_verified"] = "complete"
	}
	
	if (all_converts_complete && env['event_queue']["header_verification"] == "complete" && env['event_queue']["data_posted"] == "complete" && env['event_queue']["on_convert_complete"] == null){
		env['event_queue']["on_convert_complete"] = "started"
		on_convert_complete(env)
		env['event_queue']["on_convert_complete"] = "complete"
	}	
}

function S4() {
  return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
}
function generate_uuid() {
  return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());
}

app.get('/', function(req, res) {
	console.log("works!")
    res.writeHead(200, {'content-type': 'text/html'});
    res.end(
      '<form action="/v1/upload" enctype="multipart/form-data" method="post">'+
      '<input type="text" name="name"><br>'+
      '<input type="file" name="image" multiple="multiple"><br>'+
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
	on_header_receive(env);
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
		trigger_local_event(env,"field_"+field,"complete")
      });
     form.on('end', function() {
		fileStream.addListener("drain", function() {
			 console.log(env['uuid'] + ' save completing');
			 req.resume();
		     fileStream.end();
		     // Handle request completion, as all chunks were already written
		     on_save_complete(env);
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

