const logFile = "dolphin.log";

const mousePosNormalized = new THREE.Vector2();
const meshToChunkPosMap = new Map<THREE.Object3D, Position>();

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
    // const firstLapEndTime = session.history.laps[20].endFrame;
    // const path = session.history.getPathBetweenTimeStamps(0, firstLapEndTime);

    // const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
    // lineMaterial.linewidth = 5;
    // let lineGeometry = new THREE.Geometry();

    // for(const elem of path.path) {
    //     if(elem instanceof Position) {
    //         lineGeometry.vertices.push(
    //             new THREE.Vector3(elem.x, elem.y, elem.z),
    //         );
    //     } else {
    //         scene.add(new THREE.Line( lineGeometry, lineMaterial ));
    //         lineGeometry = new THREE.Geometry();
    //     }
    // }
    // scene.add(new THREE.Line( lineGeometry, lineMaterial ));
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

        raycaster.setFromCamera(mousePosNormalized, camera);
        const intersections = raycaster.intersectObjects(scene.children);
        if(intersections.length > 0) {
            const pos = meshToChunkPosMap.get(intersections[0].object);
            if(pos === undefined) {
                alertError("bad");
            } else {
                const textOutput = document.getElementById("text-output");
                if(textOutput === null) {
                    alertError("bad");
                } else {
                    textOutput.innerText = `${pos.x}, ${pos.y}, ${pos.z}`;
                }
            }
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
