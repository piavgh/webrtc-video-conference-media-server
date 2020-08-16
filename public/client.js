// getting webpage elements
var divRoomSelection = document.getElementById('roomSelection');
var divMeetingRoom = document.getElementById('meetingRoom');
var inputRoom = document.getElementById('room');
var inputName = document.getElementById('name');
var btnRegister = document.getElementById('register');

// variables
var roomRome;
var userName;
var participants = {};

// connecting to the socket.io server
var socket = io();

// Registering a click event for the button
btnRegister.onclick = function () {
  // we get the user name and room name from the webpage elements
  roomName = inputRoom.value;
  userName = inputName.value;

  if (roomName === '' || userName === '') {
    alert('Room and Name are required');
  } else {
    // sending message to server
    var message = {
      event: 'joinRoom',
      userName,
      roomName,
    };
    sendMessage(message);

    // toggle divs visibility
    divRoomSelection.style = 'display: none';
    divMeetingRoom.style = 'display: block';
  }
};

function sendMessage(message) {
  console.log(`Sending ${message.event} message to server`);
  socket.emit('message', message);
}

function onExistingParticipants(userId, existingUsers) {
  // create video element and add it to page
  const video = document.createElement('video');
  const div = document.createElement('div');
  div.className = 'videoContainer';
  const name = document.createElement('div');

  video.id = userId;
  video.autoplay = true;
  name.appendChild(document.createTextNode(userName));
  div.appendChild(video);
  div.appendChild(name);
  divMeetingRoom.appendChild(div);

  // create user
  const user = {
    id: userId,
    userName,
    video,
    rtcPeer: null,
  };

  participants[user.id] = user; // Add user to the global list

  // define video constraints
  const constraints = {
    audio: true,
    video: {
      mandatory: {
        maxWidth: 320,
        maxFrameRate: 15,
        minFrameRate: 15,
      },
    },
  };

  // define rtcPeerConnection object options
  const options = {
    localVideo: video,
    mediaConstraints: constraints,
    onicecandidate: onIceCandidate,
  };

  // create rtcPeerConnection object
  user.rtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options, function (
    err
  ) {
    if (err) {
      return console.error(err);
    }

    this.generateOffer(onOffer); // generate offer
  });

  // call receiveVideo for each existing participant
  existingUsers.forEach(function (element) {
    receiveVideo(element.id, element.name);
  });

  // inner functions
  const onOffer = function (err, onOffer, wp) {
    // send offers to server
    console.log('sending offer');
    const message = {
      event: 'receiveVideoFrom',
      userId: user.id,
      roomName,
      sdpOffer: offer,
    };

    sendMessage(message);
  };

  function onIceCandidate(candidate, wp) {
    // send ice candidate to server
    console.log('sending ice candidates');

    const message = {
      event: 'candidate',
      userId: user.id,
      roomName,
      candidate,
    };

    sendMessage(message);
  }
}

function receiveVideo(userId, userName) {
  // does the same thing as onExistingParticipants function
  const video = document.createElement('video');
  const div = document.createElement('div');
  div.className = 'videoContainer';
  const name = document.createElement('div');
  video.id = userId;
  video.autoplay = true;
  name.appendChild(document.createTextNode(userName));
  div.appendChild(video);
  div.appendChild(name);
  divMeetingRoom.appendChild(div);

  const user = {
    id: userId,
    userName,
    video,
    rtcPeer: null,
  };

  participants[user.id] = user;

  const options = {
    remoteVideo: video,
    onicecandidate: onIceCandidate,
  };

  user.rtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function (
    err
  ) {
    if (err) {
      return console.error(err);
    }

    this.generateOffer(onOffer);
  });

  var onOffer = function (err, offer, wp) {
    console.log('sending offer');
    const message = {
      event: 'receiveVideoFrom',
      userId: user.id,
      roomName,
      sdpOffer: offer,
    };

    sendMessage(message);
  };

  function onIceCandidate(candidate, wp) {
    console.log('sending ice candidates');
    const message = {
      event: 'candidate',
      userId: user.id,
      roomName,
      candidate,
    };

    sendMessage(message);
  }
}

function onReceiveVideoAnswer(senderid, sdpAnswer) {
  participants[senderid].rtcPeer.processAnswer(sdpAnswer);
}

function addIceCandidate(userid, candidate) {
  participants[userid].rtcPeer.addIceCandidate(candidate);
}
