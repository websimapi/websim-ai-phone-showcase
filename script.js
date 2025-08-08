import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import TWEEN from '@tweenjs/tween.js';

let scene, camera, renderer, labelRenderer, controls;
const phoneDesigns = [];
const phoneObjects = [];
let INTERSECTED;

const sceneContainer = document.getElementById('scene-container');
const loaderElement = document.getElementById('loader');
const phoneUIContainer = document.getElementById('phone-ui-container');
const phoneScreen = document.getElementById('phone-screen');
const phoneContent = document.getElementById('phone-content');
const phoneDock = document.getElementById('phone-dock');
const homeButton = document.getElementById('home-button');
const statusBar = document.getElementById('phone-status-bar');
const errorLog = document.getElementById('error-log');

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function showError(message, error) {
    console.error(message, error);
    loaderElement.classList.remove('hidden');
    loaderElement.querySelector('p').textContent = 'An error occurred. See details below.';
    loaderElement.querySelector('.spinner').style.display = 'none';
    // Ensure we have a message and stack, provide defaults if not.
    const errorMessage = error?.message || 'No message available.';
    const errorStack = error?.stack || 'No stack trace available.';
    errorLog.textContent = `Error: ${errorMessage}\n\nStack Trace:\n${errorStack}`;
}

window.addEventListener('error', function(event) {
    showError('Unhandled global error:', event.error);
});

window.addEventListener('unhandledrejection', function(event) {
    showError('Unhandled promise rejection:', event.reason);
});

// Utility to introduce a delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function uploadImageFromUrl(url, filename) {
    // Retry logic to handle potential race conditions with temporary image URLs
    for (let i = 0; i < 3; i++) {
        try {
            await sleep(500 * i); // Wait a bit before fetching, increasing delay for each retry
            const response = await fetch(url, { headers: { 'x-websim-proxy-request': 'true' } });
            if (!response.ok) {
                throw new Error(`Failed to fetch image from ${url}: ${response.statusText}`);
            }
            const blob = await response.blob();
            const file = new File([blob], filename, { type: blob.type });
            const uploadedUrl = await websim.upload(file);
            return uploadedUrl;
        } catch (error) {
            console.warn(`Attempt ${i + 1} failed for ${url}. Retrying...`, error.message);
            if (i === 2) { // If it's the last attempt, re-throw the error
                 console.error(`Error uploading image from url ${url} after 3 attempts:`, error.stack || error);
                 throw error;
            }
        }
    }
}

async function generatePhoneDesigns() {
    const themes = ["Bioluminescent Forest", "Retro-Futuristic Cityscape", "Minimalist Zen Garden", "Cosmic Ocean Depths"];
    
    for (let i = 0; i < 4; i++) {
        const theme = themes[i];
        const completion = await websim.chat.completions.create({
            messages: [{
                role: "system",
                content: `You are a creative UI/UX designer for a new mobile OS. Based on a theme, generate a design specification. Respond in JSON. The JSON should have: 'name' (a cool OS name), 'primaryColor' (hex), 'backgroundColor' (hex), 'textColor' (hex), 'wallpaperPrompt' (a DALL-E prompt for a vertical phone wallpaper), 'logoPrompt' (a DALL-E prompt for a simple, modern, abstract logo on a transparent background), and 'apps' (an array of 8 app names suitable for the theme).`
            }, {
                role: "user",
                content: `Theme: ${theme}`
            }],
            json: true,
        });

        const designSpec = JSON.parse(completion.content);

        const [wallpaperResult, logoResult] = await Promise.all([
            websim.imageGen({ prompt: designSpec.wallpaperPrompt, aspect_ratio: '9:16' }),
            websim.imageGen({ prompt: designSpec.logoPrompt, transparent: true })
        ]);

        const [persistentWallpaperUrl, persistentLogoUrl] = await Promise.all([
            uploadImageFromUrl(wallpaperResult.url, `wallpaper-${i}.png`),
            uploadImageFromUrl(logoResult.url, `logo-${i}.png`)
        ]);

        designSpec.wallpaperUrl = persistentWallpaperUrl;
        designSpec.logoUrl = persistentLogoUrl;

        const appIcons = await Promise.all(designSpec.apps.map(async (appName, appIndex) => {
             const iconResult = await websim.imageGen({
                prompt: `modern app icon for '${appName}', ${theme} theme, simple, flat design, vibrant colors`,
                transparent: true
            });
            const persistentIconUrl = await uploadImageFromUrl(iconResult.url, `app-icon-${i}-${appIndex}.png`);
            return { name: appName, iconUrl: persistentIconUrl };
        }));

        designSpec.apps = appIcons;

        phoneDesigns.push(designSpec);
    }
}

function createPhoneObject(design, index) {
    const group = new THREE.Group();

    // Phone Body
    const bodyGeometry = new THREE.BoxGeometry(0.6, 1.2, 0.05);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.5 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    group.add(body);

    // Phone Screen
    const screenGeometry = new THREE.PlaneGeometry(0.55, 1.15);
    const textureLoader = new THREE.TextureLoader();
    const screenMaterial = new THREE.MeshBasicMaterial({
        map: textureLoader.load(design.wallpaperUrl)
    });
    const screen = new THREE.Mesh(screenGeometry, screenMaterial);
    screen.position.z = 0.026;
    group.add(screen);
    group.userData.screen = screen; // for raycasting

    // Label
    const labelDiv = document.createElement('div');
    labelDiv.className = 'phone-label';
    labelDiv.textContent = design.name;
    const phoneLabel = new CSS2DObject(labelDiv);
    phoneLabel.position.set(0, -0.7, 0);
    group.add(phoneLabel);

    group.userData.id = index;
    group.userData.design = design;

    return group;
}

function setupScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101015);
    scene.fog = new THREE.Fog(0x101015, 5, 15);

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.5, 4);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    sceneContainer.appendChild(renderer.domElement);
    
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize( window.innerWidth, window.innerHeight );
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    sceneContainer.appendChild( labelRenderer.domElement );


    controls = new OrbitControls(camera, labelRenderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 2;
    controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI / 2 - 0.1;
    controls.target.set(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(5, 5, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const tableGeometry = new THREE.CylinderGeometry(2.5, 2.8, 0.2, 64);
    const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
    const table = new THREE.Mesh(tableGeometry, tableMaterial);
    table.receiveShadow = true;
    table.position.y = -0.1;
    scene.add(table);
}

function layoutPhones() {
    const positions = [
        new THREE.Vector3(-1, 0.6, 0.5),
        new THREE.Vector3(1, 0.6, 0.5),
        new THREE.Vector3(-1, 0.6, -0.5),
        new THREE.Vector3(1, 0.6, -0.5),
    ];
    const rotations = [
       -Math.PI / 6, Math.PI / 6, -Math.PI / 8, Math.PI / 8
    ];

    phoneDesigns.forEach((design, i) => {
        const phone = createPhoneObject(design, i);
        phone.position.copy(positions[i]);
        phone.rotation.set(-Math.PI / 2, 0, rotations[i]);
        phone.castShadow = true;
        scene.add(phone);
        phoneObjects.push(phone);
    });
}

function updatePhoneUI(design) {
    phoneScreen.style.backgroundImage = `url(${design.wallpaperUrl})`;
    phoneScreen.style.backgroundColor = design.backgroundColor;
    statusBar.style.color = design.textColor;
    
    phoneContent.innerHTML = '';
    phoneDock.innerHTML = '';

    const mainApps = design.apps.slice(0, 4);
    const dockApps = design.apps.slice(4, 8);

    mainApps.forEach(app => {
        const appEl = document.createElement('a');
        appEl.className = 'app-icon';
        appEl.innerHTML = `<img src="${app.iconUrl}" alt="${app.name}"><span>${app.name}</span>`;
        phoneContent.appendChild(appEl);
    });
    
     dockApps.forEach(app => {
        const appEl = document.createElement('a');
        appEl.className = 'app-icon';
        appEl.innerHTML = `<img src="${app.iconUrl}" alt="${app.name}"><span>${app.name}</span>`;
        phoneDock.appendChild(appEl);
    });
}

function onPhoneClick(phone) {
    controls.enabled = false;
    const phonePosition = new THREE.Vector3();
    phone.getWorldPosition(phonePosition);

    const targetPosition = phonePosition.clone().add(new THREE.Vector3(0, 1.5, 0.5));
    const targetLookAt = phonePosition.clone();

    new TWEEN.Tween(camera.position)
        .to(targetPosition, 1000)
        .easing(TWEEN.Easing.Quadratic.InOut)
        .start();

    new TWEEN.Tween(controls.target)
        .to(targetLookAt, 1000)
        .easing(TWEEN.Easing.Quadratic.InOut)
        .onComplete(() => {
            sceneContainer.classList.add('hidden');
            updatePhoneUI(phone.userData.design);
            phoneUIContainer.classList.remove('hidden');
        })
        .start();
}


function onPointerMove(event) {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize( window.innerWidth, window.innerHeight );
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    TWEEN.update();

    raycaster.setFromCamera(pointer, camera);
    const screens = phoneObjects.map(p => p.userData.screen);
	const intersects = raycaster.intersectObjects(screens);

    if (intersects.length > 0) {
        if (INTERSECTED != intersects[0].object) {
            if (INTERSECTED) INTERSECTED.parent.scale.set(1,1,1);
            INTERSECTED = intersects[0].object;
            INTERSECTED.parent.scale.set(1.1, 1.1, 1.1);
            document.body.style.cursor = 'pointer';
        }
    } else {
        if (INTERSECTED) INTERSECTED.parent.scale.set(1,1,1);
        INTERSECTED = null;
        document.body.style.cursor = 'auto';
    }

    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
}


async function init() {
    setupScene();
    try {
        await generatePhoneDesigns();
        layoutPhones();
        loaderElement.classList.add('hidden');
        animate();
    } catch (error) {
        console.error("Failed to initialize:", error);
        showError("Failed to initialize application.", error);
    }
}

window.addEventListener('resize', onWindowResize);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('click', () => {
    if(INTERSECTED) {
        onPhoneClick(INTERSECTED.parent);
    }
});
homeButton.addEventListener('click', () => {
    phoneUIContainer.classList.add('hidden');
    sceneContainer.classList.remove('hidden');
    controls.enabled = true;
});

init();