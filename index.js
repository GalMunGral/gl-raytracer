"use strict";
const DIRECTIONAL = 1;
const POINT = 2;
const NONE = 0;
const TRIANGLE = 1;
const SPHERE = 2;
const PLANE = 3;
function cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}
function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(v) {
    return Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
}
function normalize(v) {
    const l = norm(v);
    return [v[0] / l, v[1] / l, v[2] / l];
}
function add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function mul(v, c) {
    return [v[0] * c, v[1] * c, v[2] * c];
}
function div(v, c) {
    return [v[0] / c, v[1] / c, v[2] / c];
}
class DirectionalLight {
    dir;
    color;
    constructor(dir, color) {
        this.dir = dir;
        this.color = color;
    }
}
class PointLight {
    pos;
    color;
    constructor(pos, color) {
        this.pos = pos;
        this.color = color;
    }
}
class Triangle {
    p0;
    p1;
    p2;
    n0;
    n1;
    n2;
    st0;
    st1;
    st2;
    material;
    e1;
    e2;
    constructor(p0, p1, p2, n0, n1, n2, st0, st1, st2, material) {
        this.p0 = p0;
        this.p1 = p1;
        this.p2 = p2;
        this.n0 = n0;
        this.n1 = n1;
        this.n2 = n2;
        this.st0 = st0;
        this.st1 = st1;
        this.st2 = st2;
        this.material = material;
        const n = cross(sub(p1, p0), sub(p2, p0));
        if (!norm(n0) || !norm(n1) || !norm(n2)) {
            this.n0 = this.n1 = this.n2 = normalize(n);
        }
        this.e1 = cross(sub(this.p2, this.p0), n);
        this.e1 = div(this.e1, dot(this.e1, sub(this.p1, this.p0)));
        this.e2 = cross(sub(this.p1, this.p0), n);
        this.e2 = div(this.e2, dot(this.e2, sub(this.p2, this.p0)));
    }
}
class Sphere {
    c;
    r;
    material;
    constructor(c, r, material) {
        this.c = c;
        this.r = r;
        this.material = material;
    }
}
class Plane {
    a;
    b;
    c;
    d;
    material;
    constructor(a, b, c, d, material) {
        this.a = a;
        this.b = b;
        this.c = c;
        this.d = d;
        this.material = material;
    }
}
function compileShader(gl, shaderSource, shaderType) {
    var shader = gl.createShader(shaderType);
    gl.shaderSource(shader, shaderSource);
    gl.compileShader(shader);
    var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!success) {
        throw "could not compile shader:" + gl.getShaderInfoLog(shader);
    }
    return shader;
}
function createProgram(gl, vertexShader, fragmentShader) {
    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    var success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!success) {
        throw "program failed to link:" + gl.getProgramInfoLog(program);
    }
    return program;
}
var vertexShaderSource = `#version 300 es
 
in vec4 a_position;
uniform mat4 u_matrix;
 
void main() {
   gl_Position = u_matrix * a_position;
}
`;
async function createShaderFromScript(gl, url, opt_shaderType) {
    var shaderSource = await (await fetch(url)).text();
    return compileShader(gl, shaderSource, opt_shaderType);
}
async function createProgramFromScripts(gl) {
    var vertexShader = await createShaderFromScript(gl, "./vertex.glsl", gl.VERTEX_SHADER);
    var fragmentShader = await createShaderFromScript(gl, "./raytracing.glsl", gl.FRAGMENT_SHADER);
    return createProgram(gl, vertexShader, fragmentShader);
}
async function loadImage(filename) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = `./assets/${filename}`;
        img.onload = () => resolve(img);
    });
}
async function parseScene() {
    const filename = new URLSearchParams(location.search).get("file") || "example";
    const input = await (await fetch(`./assets/${filename}.txt`)).text();
    const sc = {
        lights: [],
        objects: [],
        aa: 1,
        d: 0,
        bounces: 2,
        expose: 0,
        focus: 0,
        lens: 0,
        eye: [0, 0, 0],
        forward: [0, 0, -1],
        right: [1, 0, 0],
        up: [0, 1, 0],
        fisheye: false,
        dof: false,
    };
    const points = [];
    const normals = [];
    const texcoords = [];
    let cur_texture = null;
    let cur_ior = 1.458;
    let cur_color = [1, 1, 1];
    let cur_normal = [0, 0, 0];
    let cur_texcoord = [0, 0];
    let cur_shininess = [0, 0, 0];
    let cur_transparency = [0, 0, 0];
    for (let line of input.split("\n")) {
        const [cmd, ...args] = line.trim().split(/\s+/);
        switch (cmd) {
            case "sun": {
                const dir = args.map((n) => +n);
                sc.lights.push(new DirectionalLight(dir, cur_color));
                break;
            }
            case "bulb": {
                const pos = args.map((n) => +n);
                sc.lights.push(new PointLight(pos, cur_color));
                break;
            }
            case "color": {
                cur_color = args.map((n) => +n);
                break;
            }
            case "xyz": {
                const pos = args.map((n) => +n);
                points.push(pos);
                normals.push(cur_normal);
                texcoords.push(cur_texcoord);
                break;
            }
            case "texcoord": {
                cur_texcoord = args.map((n) => +n);
                break;
            }
            case "normal": {
                cur_normal = args.map((n) => +n);
                break;
            }
            case "trif":
            case "trit": {
                let [i, j, k] = args.map((n) => +n);
                let n = points.length;
                i = i > 0 ? i - 1 : i + n;
                j = j > 0 ? j - 1 : j + n;
                k = k > 0 ? k - 1 : k + n;
                sc.objects.push(new Triangle(points[i], points[j], points[k], normals[i], normals[j], normals[k], texcoords[i], texcoords[j], texcoords[k], {
                    texture: cur_texture,
                    color: cur_color,
                    shininess: cur_shininess,
                    transparency: cur_transparency,
                    ior: cur_ior,
                }));
                break;
            }
            case "sphere": {
                let [x, y, z, r] = args.map((n) => +n);
                sc.objects.push(new Sphere([x, y, z], r, {
                    texture: cur_texture,
                    color: cur_color,
                    shininess: cur_shininess,
                    transparency: cur_transparency,
                    ior: cur_ior,
                }));
                break;
            }
            case "plane": {
                let [a, b, c, d] = args.map((n) => +n);
                sc.objects.push(new Plane(a, b, c, d, {
                    texture: cur_texture,
                    color: cur_color,
                    shininess: cur_shininess,
                    transparency: cur_transparency,
                    ior: cur_ior,
                }));
                break;
            }
            case "texture": {
                cur_texture = args[0] == "none" ? null : await loadImage(args[0]);
                break;
            }
            case "eye": {
                sc.eye = args.map((n) => +n);
                break;
            }
            case "forward": {
                sc.forward = normalize(args.map((n) => +n));
                sc.right = normalize(cross(sc.forward, sc.up));
                sc.up = normalize(cross(sc.right, sc.forward));
                break;
            }
            case "up": {
                sc.up = normalize(args.map((n) => +n));
                sc.right = normalize(cross(sc.forward, sc.up));
                sc.up = normalize(cross(sc.right, sc.forward));
                break;
            }
            case "fisheye": {
                sc.fisheye = true;
                break;
            }
            case "dof": {
                [sc.focus, sc.lens] = args.map((n) => +n);
                sc.dof = true;
                break;
            }
            case "expose": {
                sc.expose = +args[0];
                break;
            }
            case "aa": {
                sc.aa = +args[0];
                break;
            }
            case "gi": {
                // global illumination
                sc.d = +args[0];
                break;
            }
            case "shininess": {
                if (args.length > 1) {
                    cur_shininess = args.map((n) => +n);
                }
                else {
                    let s = +args[0];
                    cur_shininess = [s, s, s];
                }
                break;
            }
            case "transparency": {
                if (args.length > 1) {
                    cur_transparency = args.map((n) => +n);
                }
                else {
                    let t = +args[0];
                    cur_transparency = [t, t, t];
                }
                break;
            }
            case "ior": {
                cur_ior = +args[0];
                break;
            }
            case "bounces": {
                sc.bounces = +args[0];
                break;
            }
        }
    }
    console.log(sc);
    return sc;
}
async function main() {
    const canvas = document.querySelector("canvas");
    const r = 2;
    canvas.width = window.innerWidth / r;
    canvas.height = window.innerHeight / r;
    canvas.style.height = window.innerHeight + "px";
    const gl = canvas.getContext("webgl2", { antialias: true });
    const program = await createProgramFromScripts(gl);
    const vertices = [-1, 1, 1, 1, -1, -1, 1, -1];
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    var positionLoc = gl.getAttribLocation(program, "ndcCoord");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    const indices = [2, 1, 0, 1, 2, 3];
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.useProgram(program);
    const scene = await parseScene();
    const loc = (name) => gl.getUniformLocation(program, name);
    for (let [i, light] of scene.lights.entries()) {
        if (light instanceof DirectionalLight) {
            gl.uniform1i(loc(`scene.lights[${i}].type`), DIRECTIONAL);
            gl.uniform3fv(loc(`scene.lights[${i}].directional.dir`), new Float32Array(light.dir));
            gl.uniform3fv(loc(`scene.lights[${i}].directional.color`), new Float32Array(light.color));
        }
        else {
            gl.uniform1i(loc(`scene.lights[${i}].type`), POINT);
            gl.uniform3fv(loc(`scene.lights[${i}].point.pos`), new Float32Array(light.pos));
            gl.uniform3fv(loc(`scene.lights[${i}].point.color`), new Float32Array(light.color));
        }
    }
    let textureCount = 0;
    function loadMaterial(i, material) {
        gl.uniform3fv(loc(`scene.objects[${i}].material.color`), new Float32Array(material.color));
        gl.uniform1f(loc(`scene.objects[${i}].material.ior`), material.ior);
        gl.uniform3fv(loc(`scene.objects[${i}].material.shininess`), new Float32Array(material.shininess));
        gl.uniform3fv(loc(`scene.objects[${i}].material.transparency`), new Float32Array(material.transparency));
        if (material.texture) {
            const texture = gl.createTexture();
            gl.activeTexture(gl.TEXTURE0 + textureCount);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, material.texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.uniform1i(loc(`textures[${textureCount}]`), textureCount);
            gl.uniform1i(loc(`scene.objects[${i}].material.texture`), textureCount);
            ++textureCount;
        }
        else {
            gl.uniform1i(loc(`scene.objects[${i}].material.texture`), -1);
        }
    }
    for (let [i, obj] of scene.objects.entries()) {
        if (obj instanceof Triangle) {
            gl.uniform1i(loc(`scene.objects[${i}].type`), TRIANGLE);
            gl.uniform3fv(loc(`scene.objects[${i}].triangle.p0`), new Float32Array(obj.p0));
            gl.uniform3fv(loc(`scene.objects[${i}].triangle.p1`), new Float32Array(obj.p1));
            gl.uniform3fv(loc(`scene.objects[${i}].triangle.p2`), new Float32Array(obj.p2));
            gl.uniform3fv(loc(`scene.objects[${i}].triangle.n0`), new Float32Array(obj.n0));
            gl.uniform3fv(loc(`scene.objects[${i}].triangle.n1`), new Float32Array(obj.n1));
            gl.uniform3fv(loc(`scene.objects[${i}].triangle.n2`), new Float32Array(obj.n2));
            gl.uniform3fv(loc(`scene.objects[${i}].triangle.e1`), new Float32Array(obj.e1));
            gl.uniform3fv(loc(`scene.objects[${i}].triangle.e2`), new Float32Array(obj.e2));
            gl.uniform2fv(loc(`scene.objects[${i}].triangle.st0`), new Float32Array(obj.st0));
            gl.uniform2fv(loc(`scene.objects[${i}].triangle.st1`), new Float32Array(obj.st1));
            gl.uniform2fv(loc(`scene.objects[${i}].triangle.st2`), new Float32Array(obj.st2));
        }
        else if (obj instanceof Sphere) {
            gl.uniform1i(loc(`scene.objects[${i}].type`), SPHERE);
            gl.uniform3fv(loc(`scene.objects[${i}].sphere.c`), new Float32Array(obj.c));
            gl.uniform1f(loc(`scene.objects[${i}].sphere.r`), obj.r);
        }
        else if (obj instanceof Plane) {
            gl.uniform1i(loc(`scene.objects[${i}].type`), PLANE);
            gl.uniform1f(loc(`scene.objects[${i}].plane.a`), obj.a);
            gl.uniform1f(loc(`scene.objects[${i}].plane.b`), obj.b);
            gl.uniform1f(loc(`scene.objects[${i}].plane.c`), obj.c);
            gl.uniform1f(loc(`scene.objects[${i}].plane.d`), obj.d);
        }
        loadMaterial(i, obj.material);
    }
    gl.uniform2fv(loc(`viewport`), new Float32Array([canvas.width, canvas.height]));
    gl.uniform1i(loc(`num_objects`), scene.objects.length);
    gl.uniform1i(loc(`num_lights`), scene.lights.length);
    gl.uniform1i(loc(`scene.aa`), scene.aa);
    gl.uniform1i(loc(`scene.d`), scene.d);
    gl.uniform1i(loc(`scene.bounces`), scene.bounces);
    gl.uniform1f(loc(`scene.expose`), scene.expose);
    gl.uniform1f(loc(`scene.focus`), scene.focus);
    gl.uniform1f(loc(`scene.lens`), scene.lens);
    gl.uniform3fv(loc(`scene.eye`), new Float32Array(scene.eye));
    gl.uniform3fv(loc(`scene.forward`), new Float32Array(scene.forward));
    gl.uniform3fv(loc(`scene.right`), new Float32Array(scene.right));
    gl.uniform3fv(loc(`scene.up`), new Float32Array(scene.up));
    gl.uniform1i(loc(`scene.fisheye`), +scene.fisheye);
    gl.uniform1i(loc(`scene.dof`), +scene.dof);
    const keydown = {};
    window.onkeydown = (e) => {
        keydown[e.key] = true;
    };
    window.onkeyup = (e) => {
        keydown[e.key] = false;
    };
    function rotate(e1, e2, theta) {
        return [
            add(mul(e1, Math.cos(theta)), mul(e2, Math.sin(theta))),
            add(mul(e1, -Math.sin(theta)), mul(e2, Math.cos(theta))),
        ];
    }
    function updateCamera() {
        if (keydown["w"]) {
            scene.eye = add(scene.eye, mul(scene.forward, 0.05));
        }
        if (keydown["s"]) {
            scene.eye = add(scene.eye, mul(scene.forward, -0.05));
        }
        if (keydown["a"]) {
            scene.eye = add(scene.eye, mul(scene.right, -0.05));
        }
        if (keydown["d"]) {
            scene.eye = add(scene.eye, mul(scene.right, 0.05));
        }
        if (keydown["r"]) {
            scene.eye = add(scene.eye, mul(scene.up, 0.05));
        }
        if (keydown["f"]) {
            scene.eye = add(scene.eye, mul(scene.up, -0.05));
        }
        if (keydown["ArrowLeft"]) {
            [scene.right, scene.forward] = rotate(scene.right, scene.forward, 0.05);
        }
        if (keydown["ArrowRight"]) {
            [scene.right, scene.forward] = rotate(scene.right, scene.forward, -0.05);
        }
        if (keydown["ArrowUp"]) {
            [scene.forward, scene.up] = rotate(scene.forward, scene.up, 0.05);
        }
        if (keydown["ArrowDown"]) {
            [scene.forward, scene.up] = rotate(scene.forward, scene.up, -0.05);
        }
        if (keydown["q"]) {
            [scene.right, scene.up] = rotate(scene.right, scene.up, 0.05);
        }
        if (keydown["e"]) {
            [scene.right, scene.up] = rotate(scene.right, scene.up, -0.05);
        }
    }
    function render(time) {
        updateCamera();
        if (Object.values(keydown).some((v) => v)) {
            gl.uniform3fv(loc(`scene.eye`), new Float32Array(scene.eye));
            gl.uniform3fv(loc(`scene.forward`), new Float32Array(scene.forward));
            gl.uniform3fv(loc(`scene.right`), new Float32Array(scene.right));
            gl.uniform3fv(loc(`scene.up`), new Float32Array(scene.up));
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
        }
        requestAnimationFrame(render);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    requestAnimationFrame(render);
}
main();
