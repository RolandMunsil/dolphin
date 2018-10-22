let scene: THREE.Scene;
let logInterpreter: LogInterpreter;
let logFile = "dolphin.log";

beginLoadingLog();

function beginLoadingLog() {
    fetch(logFile)
    .then(response => response.text()).then(function(text) {
        logInterpreter = new LogInterpreter(text);
        logInterpreter.interpretLog();
    });
}

function createScene() {
    scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const controls = new THREE.OrbitControls( camera );

    const renderer = new THREE.WebGLRenderer();
    renderer.setClearColor('skyblue');
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    camera.position.z = 100;
    controls.update();

    function animate() {
        requestAnimationFrame( animate );
        controls.update();
    //     cube.rotation.x += 0.01;
    //     cube.rotation.y += 0.01;
        renderer.render( scene, camera );
    }
    animate();
}
