import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";

const App = () => {
  const roomName = window.location.pathname.split("/")[2];
  // const [force, setForce] = useState(false);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const videoContainerRef = useRef(null);

  let consumerTransports = [];
  let device;
  let rtpCapabilities;
  let producerTransport;
  let audioProducer;
  let videoProducer;
  let consumer;
  let isProducer = false;
  let videoContainer;
  const websocketURL = "https://3.39.21.142:3000";
  // const websocketURL = "https://simsimhae.store";

  let params = {
    // mediasoup params
    encodings: [
      {
        rid: "r0",
        maxBitrate: 100000,
        scalabilityMode: "S1T3",
      },
      {
        rid: "r1",
        maxBitrate: 300000,
        scalabilityMode: "S1T3",
      },
      {
        rid: "r2",
        maxBitrate: 900000,
        scalabilityMode: "S1T3",
      },
    ],
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
      videoGoogleStartBitrate: 1000,
    },
  };

  let audioParams;
  let videoParams = { params };
  let consumingTransports = [];

  //////////////////화상채팅시작////////////////////
  //여기
  const socket = io(`${websocketURL}/mediasoup`);

  // 소켓연결성공 하면 비디오스트림시작
  socket.on("connection-success", ({ socketId }) => {
    console.log("소켓아이디", socketId);
    getLocalStream();
  });

  // --------------------- Publish Btn 클릭 시 실행 ---------------------
  const getLocalStream = async () => {
    // Get local stream logic

    navigator.mediaDevices
      .getUserMedia({ audio: true, video: true })
      .then(streamSuccess)
      .catch((error) => {
        console.log(error.message);
      });
  };

  // 내 스트림 가져오기 성공 시 실행
  const streamSuccess = (stream) => {
    // Handle stream success
    console.log(stream);
    localVideoRef.current.srcObject = stream;

    // 예시: 미디어 스트림에서 오디오 및 비디오 트랙 가져오기

    audioParams = { track: stream.getAudioTracks()[0], ...audioParams };
    videoParams = { track: stream.getVideoTracks()[0], ...videoParams };

    joinRoom();
    // RtpCapabilities() 갖고 오기 => Device 생성
    // goConnect(true);
    // Continue with the logic using the updated `params` object
  };

  const joinRoom = async () => {
    socket.emit("joinRoom", { roomName }, (data) => {
      console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`);
      // we assign to local variable and will be used when
      // loading the client Device (see createDevice above)
      rtpCapabilities = data.rtpCapabilities;

      // once we have rtpCapabilities from the Router, create Device
      createDevice();
    });
  };

  // // Button2. 서버로부터 Rtp 가져오기
  // const getRtpCapabilities = async () => {
  //   // make a request to the server for Router RTP Capabilities
  //   // see server's socket.on('getRtpCapabilities', ...)
  //   // the server sends back data object which contains rtpCapabilities
  //   socket.emit("createRoom", (data) => {
  //     console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`);

  //     // we assign to local variable and will be used when
  //     // loading the client Device (see createDevice above)
  //     rtpCapabilities = data.rtpCapabilities;

  //     // once we have rtpCapabilities from the Router, create Device
  //     createDevice();
  //   });
  // };

  // A device is an endpoint connecting to a Router on the
  // server side to send/recive media
  // Button 3. 디바이스 생성
  const createDevice = async () => {
    try {
      device = new mediasoupClient.Device();

      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
      // Loads the device with RTP capabilities of the Router (server side)
      await device.load({
        // see getRtpCapabilities() below
        routerRtpCapabilities: rtpCapabilities,
      });

      console.log("Device Capabilities", device.rtpCapabilities);

      createSendTransport();
    } catch (error) {
      console.log(error);
      if (error.name === "UnsupportedError")
        console.warn("browser not supported");
    }
  };

  // Button 4. transport만들기 함수
  const createSendTransport = async () => {
    // see server's socket.on('createWebRtcTransport', sender?, ...)
    // this is a call from Producer, so sender = true
    socket.emit("createWebRtcTransport", { consumer: false }, ({ params }) => {
      // The server sends back params needed
      // to create Send Transport on the client side
      if (params.error) {
        console.log("에러", params.error);
        return;
      }

      console.log("정상", params);

      // creates a new WebRTC Transport to send media
      // based on the server's producer transport params
      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
      producerTransport = device.createSendTransport(params);
      console.log("파람??", params);

      // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
      // this event is raised when a first call to transport.produce() is made
      // see connectSendTransport() below
      producerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            // Signal local DTLS parameters to the server side transport
            // see server's socket.on('transport-connect', ...)
            socket.emit("transport-connect", {
              dtlsParameters,
            });
            console.log("dtl", dtlsParameters);
            // Tell the transport that parameters were transmitted.
            callback();
          } catch (error) {
            errback(error);
          }
        }
      );

      producerTransport.on("produce", async (parameters, callback, errback) => {
        console.log(parameters);

        try {
          // tell the server to create a Producer
          // with the following parameters and produce
          // and expect back a server side producer id
          // see server's socket.on('transport-produce', ...)
          socket.emit(
            "transport-produce",
            {
              kind: parameters.kind,
              rtpParameters: parameters.rtpParameters,
              appData: parameters.appData,
            },
            ({ id, producersExist }) => {
              // Tell the transport that parameters were transmitted and provide it with the
              // server side producer's id.
              callback({ id });
              // if producers exist, then join room
              if (producersExist) getProducers();
            }
          );
        } catch (error) {
          errback(error);
        }
      });
      connectSendTransport();
    });
  };

  // Button 5. 서버쪽 send transport와 연결
  const connectSendTransport = async () => {
    // try {
    audioProducer = await producerTransport.produce(audioParams);
    videoProducer = await producerTransport.produce(videoParams);
    console.log("오디오프로듀서", audioParams);
    console.log("비디오프로듀서", videoParams);

    if (!audioParams.track || !videoParams.track) {
      // 오류 처리: 유효한 오디오 또는 비디오 트랙이 없는 경우
      console.error("Missing audio or video track");
      return;
    }

    audioProducer.on("trackended", () => {
      console.log("audio track ended");

      // close audio track
    });

    audioProducer.on("transportclose", () => {
      console.log("audio transport ended");

      // close audio track
    });

    videoProducer.on("trackended", () => {
      console.log("video track ended");

      // close video track
    });

    videoProducer.on("transportclose", () => {
      console.log("video transport ended");

      // close video track
    });
    // } catch (error) {
    //   // 오류 처리: 프로듀서 생성 실패
    //   console.error("Error producing audio or video", error);
    // }
  };
  // --------------------- Publish 버튼 실행 끝 ----------------------

  // ---------------------- Consume 버튼 클릭 -----------------------
  // const goConsume = () => {
  //   // goCreateTransport() 로 Transport 생성
  //   goConnect(false);
  // };

  // const goConnect = (producerOrConsumer) => {
  //   isProducer = producerOrConsumer;
  //   // Publish 버튼 클릭 시 : getRtpCapabilityes()
  //   // Consume 버튼 클릭 시 : goCreateTransport()
  //   device === undefined ? joinRoom() : goCreateTransport();
  // };

  // const goCreateTransport = () => {
  //   // isProducer : false => createRecvTransport();
  //   isProducer ? createSendTransport() : createRecvTransport();
  // };

  // button 6. consumer transport생성
  const signalNewConsumerTransport = async (remoteProducerId) => {
    if (consumingTransports.includes(remoteProducerId)) return;
    consumingTransports.push(remoteProducerId);
    // see server's socket.on('consume', sender?, ...)
    // this is a call from Consumer, so sender = false
    socket.emit("createWebRtcTransport", { consumer: true }, ({ params }) => {
      // The server sends back params needed
      // to create Send Transport on the client side
      if (params.error) {
        console.log(params.error);
        return;
      }

      console.log(`PARAMS... ${params}`);

      let consumerTransport;
      try {
        consumerTransport = device.createRecvTransport(params);
      } catch (error) {
        // exceptions:
        // {InvalidStateError} if not loaded
        // {TypeError} if wrong arguments.
        console.log(error);
        return;
      }

      // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
      // this event is raised when a first call to transport.produce() is made
      // see connectRecvTransport() below
      consumerTransport.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            // Signal local DTLS parameters to the server side transport
            // see server's socket.on('transport-recv-connect', ...)
            socket.emit("transport-recv-connect", {
              dtlsParameters,
              serverConsumerTransportId: params.id,
            });

            // Tell the transport that parameters were transmitted.
            callback();
          } catch (error) {
            // Tell the transport that something was wrong
            errback(error);
          }
        }
      );
      connectRecvTransport(consumerTransport, remoteProducerId, params.id);
    });
  };

  // server informs the client of a new producer just joined
  socket.on("new-producer", ({ producerId }) =>
    signalNewConsumerTransport(producerId)
  );

  const getProducers = () => {
    socket.emit("getProducers", (producerIds) => {
      console.log(producerIds);
      // for each of the producer create a consumer
      // producerIds.forEach(id => signalNewConsumerTransport(id))
      producerIds.forEach(signalNewConsumerTransport);
    });
  };
  ///////////////////////////////////////////////////////////////
  const connectRecvTransport = async (
    consumerTransport,
    remoteProducerId,
    serverConsumerTransportId
  ) => {
    // for consumer, we need to tell the server first
    // to create a consumer based on the rtpCapabilities and consume
    // if the router can consume, it will send back a set of params as below
    socket.emit(
      "consume",
      {
        rtpCapabilities: device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async ({ params }) => {
        console.log("params???????", params);
        if (params.error) {
          console.log("Cannot Consume");
          return;
        }
        console.log("여기:::  params? ? ", params);

        // then consume with the local consumer transport
        // which creates a consumer
        const consumer = await consumerTransport.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters,
        });

        consumerTransports = [
          ...consumerTransports,
          {
            consumerTransport,
            serverConsumerTransportId: params.id,
            producerId: remoteProducerId,
            consumer,
          },
        ];

        /////////////////////필요없는부분
        // create a new div element for the new consumer media
        // const newElem = document.createElement("div");
        // newElem.setAttribute("id", `td-${remoteProducerId}`);

        // if (params.kind == "audio") {
        //   //append to the audio container
        //   newElem.innerHTML =
        //     '<audio id="' + remoteProducerId + '" autoplay></audio>';
        // } else {
        //   //append to the video container
        //   newElem.setAttribute("class", "remoteVideo");
        //   newElem.innerHTML =
        //     '<video id="' +
        //     remoteProducerId +
        //     '" autoplay class="video" ></video>';
        // }

        // Your code here
        // ...

        // // Example usage of createNewElement function
        // const createNewElement = (remoteProducerId, kind) => {
        //   const newElem = document.createElement("div");
        //   newElem.setAttribute("id", `td-${remoteProducerId}`);

        //   if (kind === "audio") {
        //     const audioElem = document.createElement("audio");
        //     audioElem.setAttribute("id", remoteProducerId);
        //     audioElem.setAttribute("autoplay", true);
        //     newElem.appendChild(audioElem);
        //   } else {
        //     const videoElem = document.createElement("video");
        //     videoElem.setAttribute("id", remoteProducerId);
        //     videoElem.setAttribute("autoplay", true);
        //     videoElem.setAttribute("class", "video");
        //     newElem.appendChild(videoElem);
        //   }

        //   return newElem;
        // };

        // const kind = "video";
        // const newElem = createNewElement(remoteProducerId, kind);

        // if (videoContainerRef.current) {
        //   videoContainerRef.current.appendChild(newElem);
        // }

        // destructure and retrieve the video track from the producer
        const { track } = consumer;

        console.log("consumer", consumer);
        // console.log("remoteVideoRef", remoteVideoRef);
        // remoteVideoRef.current.srcObject = new MediaStream([track]);
        remoteVideoRef.current.srcObject = new MediaStream([track]);

        // remoteVideoRef.current.srcObject = new MediaStream([track]);
        // remoteVideoRef.current.srcObject = new MediaStream([track]);

        // the server consumer started with media paused
        // so we need to inform the server to resume

        socket.emit("consumer-resume", {
          serverConsumerId: params.serverConsumerId,
        });
        // setForce((prev) => !prev);
      }
    );
  };

  socket.on("producer-closed", ({ remoteProducerId }) => {
    // server notification is received when a producer is closed
    // we need to close the client-side consumer and associated transport
    const producerToClose = consumerTransports.find(
      (transportData) => transportData.producerId === remoteProducerId
    );
    producerToClose.consumerTransport.close();
    producerToClose.consumer.close();

    // remove the consumer transport from the list
    consumerTransports = consumerTransports.filter(
      (transportData) => transportData.producerId !== remoteProducerId
    );
    // // remove the video div element
    // videoContainer.removeChild(
    //   document.getElementById(`td-${remoteProducerId}`)
    // );
  });

  // -------------------------- Consumer로직 끝 -----------------------
  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Local Video</th>
            <th>Remote Video</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div id="sharedBtns">
                <video
                  style={{ border: "1px solid black" }}
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  className="video"
                ></video>
              </div>
            </td>
            <td>
              <div>
                <video
                  style={{ border: "1px solid black" }}
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="video"
                ></video>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export default App;
