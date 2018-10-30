const logFile = "dolphin.log";

let mouseDown = false;
let click = false;
window.addEventListener('mousedown', ()=>{mouseDown = true; click = true;});
window.addEventListener('mouseup', ()=>{mouseDown = false; click = false;});

let textOutput: HTMLTextAreaElement;
window.onload = function() { 
    textOutput = document.getElementById("text-output") as HTMLTextAreaElement;
    if(textOutput === null || textOutput === undefined) {
        alertError("Textoutput is null");
    }
};

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

function clearTextDisplay() {
    textOutput.value = "";
}
function writeToTextDisplay(str: string) {
    textOutput.value += `${str}`;
}
function writeLineToTextDisplay(str: string) {
    textOutput.value += `${str}\r\n`;
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

function updateInfoText(chunkPos: AIPosition) {
    const sesInfo = aiSession.sessionInfo;
    clearTextDisplay();
    writeLineToTextDisplay(`${sesInfo.hoursToNoExploration} hours to 0 exploration`);
    writeLineToTextDisplay(`Learn rate: ${sesInfo.learningRate} | Discount rate: ${sesInfo.discountRate}`);
    writeLineToTextDisplay(`Chunk size: ${sesInfo.chunkSize}`);
    writeLineToTextDisplay("===========================================================");

    const frames = aiSession.history.getFramesAssociatedWithChunk(chunkPos);
    writeLineToTextDisplay(`Selected chunk: (${chunkPos.x}, ${chunkPos.y}, ${chunkPos.z})`);

    let framesStr = "";
    let visitCount = 0;
    let updateCount = 0;

    let prevFrame: AIFrame | null = null;
    let prevFrameNumber = -1;
    let expectingQTableUpdate = false;
    for(const [frameInfo, frameNumber] of frames) {
        if(frameInfo.qTableUpdate !== null && frameInfo.qTableUpdate.updatedStateChunkPosition.equals(chunkPos)) {
            // Chunk table was updated
            updateCount++;
            expectingQTableUpdate = false;
            
            if(prevFrame === null || prevFrameNumber+1 !== frameNumber) {
                alertError("Unexpected update");
                framesStr += "Unexpected update\r\n";
            } else if(prevFrame !== null) {
                assert(frameInfo.qTableUpdate.actionIndex === prevFrame.actionTaken,"Invalid frame pairing");
                framesStr += ` -> ${frameInfo.qTableUpdate.newValue}\r\n`;
            }
        } else if(expectingQTableUpdate) {
            framesStr += " -> [NO UPDATE]\r\n";
            expectingQTableUpdate = false;
        }
        if(chunkContainingPosition(frameInfo.vehiclePos, sesInfo.chunkSize).equals(chunkPos)) {
            expectingQTableUpdate = true;
            visitCount++;
            framesStr += `F${frameNumber}: `;
            framesStr += `${Action[frameInfo.actionTaken]} (rw=${frameInfo.vehicleGoingRightDirection}) (best=${frameInfo.bestActionTaken})`;
        }
        prevFrame = frameInfo;
        prevFrameNumber = frameNumber;
    }
    if(expectingQTableUpdate) {
        framesStr += " -> [NO UPDATE]\r\n";
    }

    writeLineToTextDisplay(`Visit/Update: ${visitCount}/${updateCount}`);
    writeLineToTextDisplay("----------------");
    writeToTextDisplay(framesStr);
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
                    updateInfoText(pos);
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
