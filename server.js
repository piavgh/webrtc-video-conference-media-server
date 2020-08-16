const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const kurento = require('kurento-client');
const minimist = require('minimist');

// variables
const kurentoClient = null;
const iceCandidateQueues = {};

// constants
const argv = minimist(process.argv.slice(2), {
  default: {
    as_uri: 'http://localhost:3000',
    ws_uri: 'ws://localhost:8888/kurento',
  },
});

// static hosting on public folder
app.use(express.static('public'));

function joinRoom(socket, userName, roomName, callback) {
  getRoom(socket, roomName, (err, myRoom) => {
    if (err) {
      return callback(err);
    }

    // create a new WebRTC endpoint
    myRoom.pipeline.create('WebRtcEndpoint', (err, outgoingMedia) => {
      if (err) {
        return callback(err);
      }

      // create an user and assign the outgoingMedia endpoint to it
      const user = {
        id: socket.id,
        name: userName,
        outgoingMedia,
        incomingMedia: {},
      };

      // if there is any ice candidate on queue, set it now
      let iceCandidateQueue = iceCandidateQueues[user.id];
      if (iceCandidateQueue) {
        while (iceCandidateQueue.length) {
          let ice = iceCandidateQueue.shift();
          console.log(
            `user: ${user.name} collect candidate for outgoing media`
          );
          user.outgoingMedia.addIceCandidate(ice.candidate);
        }
      }

      // set endpoint's onIceCandidate event
      user.outgoingMedia.on('OnIceCandidate', (event) => {
        let candidate = kurento.register.complexTypes.IceCandidate(
          event.candidate
        );
        socket.emit('message', {
          event: 'candidate',
          userId: user.id,
          candidate,
        });
      });

      // notify other users about new participant
      socket.to(roomName).emit('message', {
        event: 'newParticipantArrived',
        userId: user.id,
        userName: user.name,
      });

      // get IDs and names of existing participants
      let existingUsers = [];
      for (let i in myRoom.participants) {
        if (myRoom.participants[i].id !== user.id) {
          existingUsers.push({
            id: myRoom.participants[i].id,
            name: myRoom.participants[i].name,
          });
        }
      }

      // send list of existing participants to current user
      socket.emit('message', {
        event: 'existingParticipants',
        existingUsers,
        userId: user.id,
      });

      // add current user to the list of participants
      myRoom.participants[user.id] = user;
    });
  });
}

function getRoom(socket, roomName, callback) {
  // Count number of users in the room
  let myRoom = io.sockets.adapter.rooms[roomName] || { length: 0 };
  const numClients = myRoom.length;
  console.log(roomName + ' has ' + numClients + ' clients');

  if (numClients === 0) {
    // first client
    socket.join(roomName, () => {
      // create room
      myRoom = io.sockets.adapter.rooms[roomName]; // get proper room ref
      getKurentoClient((error, kurento) => {
        // creating media pipeline
        kurento.create('MediaPipeline', (err, pipeline) => {
          if (error) {
            return callback(err);
          }

          // set pipeline and an empty list of participants to room
          myRoom.pipeline = pipeline;
          myRoom.participants = {};
          callback(null, myRoom); // returns to joinRoom function
        });
      });
    });
  } else {
    // additional users
    socket.join(roomName); // adds the user to the room
    callback(null, myRoom);
  }
}

// handlers for events received
io.on('connection', function (socket) {
  console.log('a user connected');

  socket.on('message', function (message) {
    console.log('Message received: ', message.event);

    switch (message.event) {
      case 'joinRoom':
        joinRoom(socket, message.userName, message.roomName, (err) => {
          if (err) {
            console.error(err);
          }
        });
        break;
      case 'receiveVideoFrom':
        receiveVideoFrom(
          socket,
          message.userId,
          message.roomName,
          message.sdpOffer,
          (err) => {
            if (err) {
              console.error(err);
            }
          }
        );
        break;
      case 'candidate':
        addIceCandidate(
          socket,
          message.userId,
          message.roomName,
          message.candidate,
          (err) => {
            if (err) {
              console.error(err);
            }
          }
        );
        break;
    }
  });
});

function receiveVideoFrom(socket, userid, roomname, sdpOffer, callback) {
  getEndpointForUser(socket, roomname, userid, (err, endpoint) => {
    if (err) {
      return callback(err);
    }

    endpoint.processOffer(sdpOffer, (err, sdpAnswer) => {
      if (err) {
        return callback(err);
      }

      socket.emit('message', {
        event: 'receiveVideoAnswer',
        senderid: userid,
        sdpAnswer: sdpAnswer,
      });

      endpoint.gatherCandidates((err) => {
        if (err) {
          return callback(err);
        }
      });
    });
  });
}

// When receiving an ice candidate, it is added to the correspondent endpoint
function addIceCandidate(socket, senderid, roomname, iceCandidate, callback) {
  let user = io.sockets.adapter.rooms[roomname].participants[socket.id];
  if (user != null) {
    let candidate = kurento.register.complexTypes.IceCandidate(iceCandidate);
    if (senderid == user.id) {
      if (user.outgoingMedia) {
        user.outgoingMedia.addIceCandidate(candidate);
      } else {
        iceCandidateQueues[user.id].push({ candidate: candidate });
      }
    } else {
      if (user.incomingMedia[senderid]) {
        user.incomingMedia[senderid].addIceCandidate(candidate);
      } else {
        if (!iceCandidateQueues[senderid]) {
          iceCandidateQueues[senderid] = [];
        }
        iceCandidateQueues[senderid].push({ candidate: candidate });
      }
    }
    callback(null);
  } else {
    callback(new Error('addIceCandidate failed'));
  }
}

function getEndpointForUser(socket, roomname, senderid, callback) {
  var myRoom = io.sockets.adapter.rooms[roomname];
  var asker = myRoom.participants[socket.id];
  var sender = myRoom.participants[senderid];

  if (asker.id === sender.id) {
    return callback(null, asker.outgoingMedia);
  }

  if (asker.incomingMedia[sender.id]) {
    sender.outgoingMedia.connect(asker.incomingMedia[sender.id], (err) => {
      if (err) {
        return callback(err);
      }
      callback(null, asker.incomingMedia[sender.id]);
    });
  } else {
    myRoom.pipeline.create('WebRtcEndpoint', (err, incoming) => {
      if (err) {
        return callback(err);
      }

      asker.incomingMedia[sender.id] = incoming;

      let iceCandidateQueue = iceCandidateQueues[sender.id];
      if (iceCandidateQueue) {
        while (iceCandidateQueue.length) {
          let ice = iceCandidateQueue.shift();
          console.error(
            `user: ${sender.name} collect candidate for outgoing media`
          );
          incoming.addIceCandidate(ice.candidate);
        }
      }

      incoming.on('OnIceCandidate', (event) => {
        let candidate = kurento.register.complexTypes.IceCandidate(
          event.candidate
        );
        socket.emit('message', {
          event: 'candidate',
          userid: sender.id,
          candidate: candidate,
        });
      });

      sender.outgoingMedia.connect(incoming, (err) => {
        if (err) {
          return callback(err);
        }
        callback(null, incoming);
      });
    });
  }
}

// function to get Kurento client from media server
function getKurentoClient(callback) {
  if (kurentoClient !== null) {
    return callback(null, kurentoClient);
  }

  kurento(argv.ws_uri, function (error, _kurentoClient) {
    if (error) {
      console.error('Could not find media server at address: ' + argv.ws_uri);
      return callback(
        'Could not find media server at address: ' +
          argv.ws_uri +
          '. Exiting with error ' +
          error
      );

      kurentoClient = _kurentoClient;
      callback(null, kurentoClient);
    }
  });
}

// listener
http.listen(3000, function () {
  console.log('Server listening on port 3000!');
});
