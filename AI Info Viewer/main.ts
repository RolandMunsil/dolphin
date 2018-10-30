const logFile = "dolphin DELETEME.log";

let mouseDown = false;
let click = false;
window.addEventListener('mousedown', ()=>{mouseDown = true; click = true;});
window.addEventListener('mouseup', ()=>{mouseDown = false; click = false;});


const mousePosNormalized = new THREE.Vector2();
const meshToChunkPosMap = new Map<THREE.Object3D, AIPosition>();
let aiSession: AISession;

startLogParsing();

function startLogParsing() {
    fetch("logs/"+logFile)
    .then(response => response.text())
    .then(function(text) {
        const parser = new LogParser(text);
        const info = parser.parse();
        displayInfo(info);
    });
}

function displayInfo(session: AISession) {
    aiSession = session;

    console.log('Laps:');
    console.log(session.history.laps.map(l=>l.timeMillis).join(";"));
    console.log('Death times:');
    console.log(session.history.getAllDeathTimes().join(";"));

    const qTable = session.history.constructQTableAsOfNow();
    const chunkSize = session.sessionInfo.chunkSize;

    const scene = createScene();
    const geometry = new THREE.BoxGeometry(chunkSize, chunkSize, chunkSize);
    for(const coord of qTable.chunkCoords) {
        const val = qTable.getChunk(coord).getValue(true, Action.FORWARD);
        const color = new THREE.Color(val/2000, val/2000, val/2000);
        const material = new THREE.MeshBasicMaterial({ color: color });
        //material.transparent = true;
        //material.opacity = 0.05;
        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(coord.x * chunkSize, coord.y * chunkSize, coord.z * chunkSize);
        scene.add(cube);
        meshToChunkPosMap.set(cube, coord);
    }
}

function updateInfoText(textOutput: HTMLTextAreaElement, chunkPos: AIPosition) {
    const sesInfo = aiSession.sessionInfo;
    textOutput.value = `${sesInfo.hoursToNoExploration} hours to exploration=0\r\n`;
    textOutput.value += `Learn rate: ${sesInfo.learningRate} | Discount rate: ${sesInfo.discountRate}\r\n`;
    textOutput.value += `Chunk size: ${sesInfo.chunkSize}\r\n`;
    textOutput.value += "===========================================================\r\n";

    const frames = aiSession.history.getFramesAssociatedWithChunk(chunkPos);
    textOutput.value += `Selected chunk: (${chunkPos.x}, ${chunkPos.y}, ${chunkPos.z})\r\n`;

    let framesStr = "";
    let visitCount = 0;
    let updateCount = 0;

    let prevFrame: AIFrame | null = null;
    let prevFrameNumber = -1;
    for(const [frameInfo, frameNumber] of frames) {
        if(frameInfo.qTableUpdate !== null && frameInfo.qTableUpdate.updatedStateChunkPosition.equals(chunkPos)) {
            // Chunk table was updated
            updateCount++;
            
            if(prevFrame === null || prevFrameNumber+1 !== frameNumber) {
                alertError("Unexpected update");
                framesStr += "Unexpected update\r\n";
            } else if(prevFrame !== null) {
                assert(frameInfo.qTableUpdate.actionIndex === prevFrame.actionTaken,"Invalid frame pairing");
                framesStr += ` -> ${frameInfo.qTableUpdate.newValue}\r\n`;
            }
        }
        if(chunkContainingPosition(frameInfo.vehiclePos, sesInfo.chunkSize).equals(chunkPos)) {
            visitCount++;
            framesStr += `F${frameNumber}: `;
            framesStr += `${Action[frameInfo.actionTaken]} (rw=${frameInfo.vehicleGoingRightDirection}) (best=${frameInfo.bestActionTaken})`;
        }
        prevFrame = frameInfo;
        prevFrameNumber = frameNumber;
    }
    textOutput.value += `Visit/Update: ${visitCount}/${updateCount}\r\n`;
    textOutput.value += "----------------\r\n";
    textOutput.value += framesStr;
}

function createScene() {
    const renderWidth = window.innerWidth/2;
    const renderHeight = window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, renderWidth / renderHeight, 0.1, 100000);
    camera.position.z = 1000;
    const controls = new THREE.OrbitControls(camera);

    const renderer = new THREE.WebGLRenderer({ alpha: true });
    renderer.setClearColor('skyblue');
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(renderWidth, renderHeight);
    document.body.appendChild(renderer.domElement);

    const raycaster = new THREE.Raycaster();
    function animate() {
        requestAnimationFrame(animate);
        controls.update();

        if(click) {
            raycaster.setFromCamera(mousePosNormalized, camera);
            const intersections = raycaster.intersectObjects(scene.children);
            if(intersections.length > 0) {
                const pos = meshToChunkPosMap.get(intersections[0].object);
                if(pos === undefined) {
                    alertError("bad");
                } else {
                    const textOutput = document.getElementById("text-output") as HTMLTextAreaElement;
                    if(textOutput === null) {
                        alertError("bad");
                    } else {
                        updateInfoText(textOutput, pos);
                    }
                }
            }
            click = false;
        }

        renderer.render(scene, camera);
    }
    animate();
    const onMouseMove = function(event: MouseEvent) {
        const canvasRect = renderer.domElement.getBoundingClientRect();
        const x = event.clientX - canvasRect.left;
        const y = event.clientY - canvasRect.top;
        mousePosNormalized.x = (x / canvasRect.width) * 2 - 1;
        mousePosNormalized.y = -(y / canvasRect.height) * 2 + 1;
    };
    window.addEventListener('mousemove', onMouseMove);
    return scene;
}
