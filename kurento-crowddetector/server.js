/*
 * (C) Copyright 2014 Kurento (http://kurento.org/)
 *
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the GNU Lesser General Public License
 * (LGPL) version 2.1 which accompanies this distribution, and is available at
 * http://www.gnu.org/licenses/lgpl-2.1.html
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 */

var path = require('path');
var express = require('express');
var session = require('express-session');
var ws = require('ws');
var minimist = require('minimist');
var url = require('url');
var kurento = require('kurento-client');
var fs = require('fs');
var pathIsInside = require('path-is-inside');

var argv = minimist(process.argv.slice(2),
                    {
                        default:
                        {
                            as_uri: "http://localhost:8080/",
                            ws_uri: "ws://localhost:8888/kurento"
                        }
                    });

var app = express();

kurento.register(require('kurento-module-crowddetector'));

/*
 * Management of sessions
 */
app.use(express.cookieParser());

var sessionHandler = session({
    secret : 'none',
    rolling : true,
    resave : true,
    saveUninitialized : true
});

app.use(sessionHandler);


/*
 * Definition of global variables.
 */
var pipelines = {};
var kurentoClient = null;

/*
 * Server startup
 */

var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;

var cfg = {
    ssl: false,
    port: port,
    ssl_key: 'certs/server.key',
    ssl_cert: 'certs/server.crt'
};

var httpServ = ( cfg.ssl ) ? require('https') : require('http');

var server = null;

if (cfg.ssl) {
    server = httpServ.createServer({
        // providing server with  SSL key/cert
        key: fs.readFileSync( cfg.ssl_key ),
        cert: fs.readFileSync( cfg.ssl_cert )
    }, app);
} else {
    server = httpServ.createServer(app);
}

server.listen(port, function() {
    console.log('Kurento Tutorial started');
    console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
});

// server = app.listen(port, function() {
//     console.log('Kurento Tutorial started');
//     console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
// });

var WebSocketServer = ws.Server, wss = new WebSocketServer({
    server : server,
    path : '/crowddetector'
});

/*
 * Management of WebSocket messages
 */
wss.on('connection', function(ws) {
    var sessionId = null;
    var request = ws.upgradeReq;
    var response = {
	writeHead : {}
    }; // black magic here

    sessionHandler(request, response, function(err) {
	sessionId = request.session.id;
	console.log("Connection received with sessionId " + sessionId);
    });

    ws.on('error', function(error) {
	console.log('Connection ' + sessionId + ' error');
	stop(sessionId);
    });

    ws.on('close', function() {
	console.log('Connection ' + sessionId + ' closed');
	stop(sessionId);
    });

    ws.on('message', function(_message) {
	var message = JSON.parse(_message);
	console.log('Connection ' + sessionId + ' received message ', message);

	switch (message.id) {
	case 'start':
	    start(sessionId, message.sdpOffer, message.dots, function(error, type, data) {
		if (error) {
		    return ws.send(JSON.stringify({
			id : 'error',
			message : error.message || error,
			data: error
		    }));
		}
		switch (type) {
		case 'sdpAnswer':
		    ws.send(JSON.stringify({
			id : 'startResponse',
			sdpAnswer : data
		    }));
		    break;
		case 'crowdDetectorDirection':
		    ws.send(JSON.stringify({
			id : 'crowdDetectorDirection',
			event_data : data
		    }));
		    break;
		case 'crowdDetectorFluidity':
		    ws.send(JSON.stringify({
			id : 'crowdDetectorFluidity',
			event_data : data
		    }));
		    break;
		case 'crowdDetectorOccupancy':
		    ws.send(JSON.stringify({
			id : 'crowdDetectorOccupancy',
			event_data : data
		    }));
		    break;
		}
	    });
	    break;
        case 'getVideo':
            getVideo(sessionId, message.url, message.filter, message.dots, message.sdpOffer, function(error, sdpAnswer, type) {
                if (error) {
                    ws.send(JSON.stringify({
                        id : 'getVideo',
                        response : "can't send it",
                        message : error
                    }));
                } else {
                    switch(type) {
                    case 'video':
                        ws.send(JSON.stringify({
                            id : 'getVideo',
                            response : 'accepted',
                            filter: false,
                            sdpAnswer : sdpAnswer
                        }));
                        break;
                    case 'videoFilter':
                        ws.send(JSON.stringify({
                            id : 'getVideo',
                            response : 'accepted',
                            filter: true,
                            sdpAnswer : sdpAnswer
                        }));

                    case 'crowdDetectorDirection':
                        ws.send(JSON.stringify({
                            id : 'crowdDetectorDirection',
                            event_data : sdpAnswer
                        }));
                        break;
                    case 'crowdDetectorFluidity':
                        ws.send(JSON.stringify({
                            id : 'crowdDetectorFluidity',
                            event_data : sdpAnswer
                        }));
                        break;
                    case 'crowdDetectorOccupancy':
                        ws.send(JSON.stringify({
                            id : 'crowdDetectorOccupancy',
                            event_data : sdpAnswer
                        }));
                        break;
                    }
                }
            });
            break;
	case 'stop':
	    stop(sessionId);
	    break;

	default:
	    ws.send(JSON.stringify({
		id : 'error',
		message : 'Invalid message ' + message
	    }));
	    break;
	}
    });
});

/*
 * Definition of functions
 */

// Recover kurentoClient for the first time.
function getKurentoClient(callback) {
    if (kurentoClient !== null) {
	return callback(null, kurentoClient);
    }

    kurento(argv.ws_uri, function(error, _kurentoClient) {
	if (error) {
	    console.log("Could not find media server at address " + argv.ws_uri);
	    return callback("Could not find media server at address" + argv.ws_uri
			    + ". Exiting with error " + error);
	}

	kurentoClient = _kurentoClient;
	callback(null, kurentoClient);
    });
}

function parse_url (url_path) {
    var parsed = url.parse(url_path);
    var final_path = "";
    if (parsed.protocol) {
        if (parsed.protocol === 'http:' || parsed.protocol === 'https://') {
            final_path = url_path;
        } else {
            console.log("Can't resolve an absolute path.");
        }
    } else {
        var abs_path = path.resolve(__dirname, url_path);
        if (!pathIsInside(abs_path, __dirname)) {
            console.log("Tried to access other path.");
        } else {
            try {
                fs.openSync(abs_path, 'r');
                final_path = 'file://' + abs_path;
            } catch (err) {
                console.log("Can't read the file " + abs_path);
                final_path = "";
            }
        }
    }
    return final_path;
}

function getVideo (sessionId, url_path, filt, dots, sdpOffer, callback) {
    var last_url = "";
    var abs_path = parse_url(url_path);
    if (abs_path === "") {
        return callback("File "+ url_path + " not found or can't resolve.");
    }
    if (!sessionId) {
        return callback("Cannot use undefined sessionId");
    }
    if (pipelines[sessionId]) {
        return callback("Session used");
    }
    getKurentoClient(function(error, kurentoClient) {
        if (error) {
            return callback(error);
        }
        kurentoClient.create('MediaPipeline', function(error, pipeline) {
            if (error) return callback(error);
            function release() {
                pipeline.release();
            }
            pipeline.create("WebRtcEndpoint", function(error, webRtcEndpoint) {
                if (error) return callback(error);
                //webRtcEndpoint.setMaxVideoSendBandwidth(2000000);
                //webRtcEndpoint.setMinVideoSendBandwidth(2000000);
                pipeline.create("PlayerEndpoint", {uri: abs_path}, function(error, playerEndpoint) {
                    if (error) return callback(error);
                    if (filt) { // If want to do a filter
                        var ps = create_rois(dots);
                        pipeline.create('CrowdDetectorFilter', {'rois': ps}, function (error, crowdDetector) {
                            if (error) return callback(error);
                            playerEndpoint.connect(crowdDetector, 'VIDEO', function(error) {
                                if (error) return callback(error);

                                crowdDetector.on ('CrowdDetectorDirection', function (_data){
                                    return callback(null, _data, 'crowdDetectorDirection');
                                });

                                crowdDetector.on ('CrowdDetectorFluidity', function (_data){
                                    return callback(null, _data, 'crowdDetectorFluidity');
                                });

                                crowdDetector.on ('CrowdDetectorOccupancy', function (_data){
                                    return callback(null, _data, 'crowdDetectorOccupancy');
                                });

                                crowdDetector.connect(webRtcEndpoint, function(error) {
                                    if (error) return callback(error);
                                    webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
                                        if (error) {
                                            release();
                                            return callback(error);
                                        }
                                        playerEndpoint.on('EndOfStream', function() {
                                            playerEndpoint.play();
                                        });
                                        playerEndpoint.play();
                                        pipelines[sessionId] = pipeline;
                                        return callback(null, sdpAnswer, 'videoFilter');
                                    });
                                });
                            });
                        });
                    } else { // Only player
                        playerEndpoint.connect(webRtcEndpoint, function(error) {
                            if (error) return callback(error);
                            // sdpOffer = sdpOffer.replace( /b=AS([^\r\n]+\r\n)/g , '');
                            // sdpOffer = sdpOffer.replace( /a=mid:video\r\n/g , 'a=mid:video\r\nb=AS:1638400\r\n');
                            // console.log(sdpOffer);
                            webRtcEndpoint.processOffer(sdpOffer, function(error, sdpAnswer) {
                                if (error) {
                                    release();
                                    return callback(error);
                                }
                                playerEndpoint.on('EndOfStream', function() {
                                    playerEndpoint.play();
                                });
                                playerEndpoint.play();
                                pipelines[sessionId] = pipeline;
                                return callback(null, sdpAnswer, 'video');
                            });
                        });
                    }
                });
            });
        });
    });
};

var create_rois = function (dots) {
    var ps = [];
    for(var i=0; i<dots.length; i++){
        ps.push({
            'id': 'roi'+(i+1),
            'points':dots[i],
            'regionOfInterestConfig' : {
                'occupancyLevelMin' : 10,
                'occupancyLevelMed' : 35,
                'occupancyLevelMax' : 65,
                'occupancyNumFramesToEvent' : 2,
                'fluidityLevelMin' : 10,
                'fluidityLevelMed' : 35,
                'fluidityLevelMax' : 65,
                'fluidityNumFramesToEvent' : 2,
                'sendOpticalFlowEvent' : false,
                'opticalFlowNumFramesToEvent' : 3,
                'opticalFlowNumFramesToReset' : 3,
                'opticalFlowAngleOffset' : 0
            }
            // 'regionOfInterestConfig' : {
            //     'occupancyLevelMin' : 10,
            //     'occupancyLevelMed' : 35,
            //     'occupancyLevelMax' : 65,
            //     'occupancyNumFramesToEvent' : 5,
            //     'fluidityLevelMin' : 10,
            //     'fluidityLevelMed' : 35,
            //     'fluidityLevelMax' : 65,
            //     'fluidityNumFramesToEvent' : 5,
            //     'sendOpticalFlowEvent' : false,
            //     'opticalFlowNumFramesToEvent' : 3,
            //     'opticalFlowNumFramesToReset' : 3,
            //     'opticalFlowAngleOffset' : 0
            // }
        });
    }
    return ps;
};


function start(sessionId, sdpOffer, dots, callback) {

    if (!sessionId) {
	return callback("Cannot use undefined sessionId");
    }

    // Check if session is already transmitting
    if (pipelines[sessionId]) {
	return callback("Close current session before starting a new one or use another browser to open a tutorial.")
    }

    getKurentoClient(function(error, kurentoClient) {
	if (error) {
	    return callback(error);
	}

	kurentoClient.create('MediaPipeline', function(error, pipeline) {
	    if (error) {
		return callback(error);
	    }

	    createMediaElements(pipeline, dots, function(error, webRtcEndpoint, crowdDetector) {
		if (error) {
		    pipeline.release();
		    return callback(error);
		}

		connectMediaElements(webRtcEndpoint, crowdDetector,
				     function(error) {
					 if (error) {
					     pipeline.release();
					     return callback(error);
					 }

					 crowdDetector.on ('CrowdDetectorDirection', function (_data){
					     return callback(null, 'crowdDetectorDirection', _data);
					 });

					 crowdDetector.on ('CrowdDetectorFluidity', function (_data){
					     return callback(null, 'crowdDetectorFluidity', _data);
					 });

					 crowdDetector.on ('CrowdDetectorOccupancy', function (_data){
					     return callback(null, 'crowdDetectorOccupancy', _data);
					 });

					 webRtcEndpoint.processOffer(sdpOffer, function(
					     error, sdpAnswer) {
					     if (error) {
						 pipeline.release();
						 return callback(error);
					     }

					     pipelines[sessionId] = pipeline;
					     return callback(null, 'sdpAnswer', sdpAnswer);
					 });
				     });
	    });
	});
    });
}

function createMediaElements(pipeline, dots, callback) {
    pipeline.create('WebRtcEndpoint', function(error, webRtcEndpoint) {
	if (error) {
	    return callback(error);
	}

        var ps = create_rois(dots);

	pipeline.create('CrowdDetectorFilter', {'rois' : ps},
			function(error, crowdDetector) {
			    if (error) {
				return callback(error);
			    }
			    return callback(null, webRtcEndpoint,
					    crowdDetector);
			});
    });
}

function connectMediaElements(webRtcEndpoint, crowdDetector, callback) {
    webRtcEndpoint.connect(crowdDetector, function(error) {
	if (error) {
	    return callback(error);
	}

	crowdDetector.connect(webRtcEndpoint, function(error) {
	    if (error) {
		return callback(error);
	    }

	    return callback(null);
	});
    });
}

function stop(sessionId) {
    if (pipelines[sessionId]) {
	var pipeline = pipelines[sessionId];
	pipeline.release();
	delete pipelines[sessionId];
    }
}

app.use(express.static(path.join(__dirname, 'static')));
