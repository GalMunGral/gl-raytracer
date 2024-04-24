type int = number;
type float = number;
type vec2 = [number, number];
type vec3 = [number, number, number];

const DIRECTIONAL = 0;
const POINT = 1;

const TRIANGLE = 0;
const SPHERE = 1;
const PLANE = 2;

function cross(a: vec3, b: vec3): vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: vec3, b: vec3): float {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(v: vec3) {
  return Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
}

function normalize(v: vec3): vec3 {
  const l = norm(v);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function add(a: vec3, b: vec3): vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: vec3, b: vec3): vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mul(v: vec3, c: float): vec3 {
  return [v[0] * c, v[1] * c, v[2] * c];
}

function div(v: vec3, c: float): vec3 {
  return [v[0] / c, v[1] / c, v[2] / c];
}

class DirectionalLight {
  constructor(public dir: vec3, public color: vec3) {}
}

class PointLight {
  constructor(public pos: vec3, public color: vec3) {}
}

interface Material {
  shininess: vec3;
  transparency: vec3;
  ior: float;
  texture: HTMLImageElement | null;
  color: vec3;
}

class Triangle {
  public e1: vec3;
  public e2: vec3;
  constructor(
    public p0: vec3,
    public p1: vec3,
    public p2: vec3,
    public n0: vec3,
    public n1: vec3,
    public n2: vec3,
    public st0: vec2,
    public st1: vec2,
    public st2: vec2,
    public mtl: Material
  ) {
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
  constructor(public c: vec3, public r: float, public mtl: Material) {}
}

class Plane {
  constructor(
    public a: float,
    public b: float,
    public c: float,
    public d: float,
    public mtl: Material
  ) {}
}

interface Scene {
  lights: Array<DirectionalLight | PointLight>;
  objects: Array<Triangle | Sphere | Plane>;
  aa: int;
  d: int;
  bounces: int;
  expose: float;
  focus: float;
  lens: float;
  eye: vec3;
  forward: vec3;
  right: vec3;
  up: vec3;
  fisheye: boolean;
  dof: boolean;
}

function compileShader(
  gl: WebGL2RenderingContext,
  shaderSource: string,
  shaderType: GLenum
) {
  var shader = gl.createShader(shaderType)!;
  gl.shaderSource(shader, shaderSource);
  gl.compileShader(shader);
  var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (!success) {
    throw "could not compile shader:" + gl.getShaderInfoLog(shader);
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
) {
  var program = gl.createProgram()!;
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

async function createShaderFromScript(
  gl: WebGL2RenderingContext,
  url: string,
  opt_shaderType: GLenum
) {
  var shaderSource = await (await fetch(url)).text();
  return compileShader(gl, shaderSource, opt_shaderType);
}

async function createProgramFromScripts(gl: WebGL2RenderingContext) {
  var vertexShader = await createShaderFromScript(
    gl,
    "./vertex.glsl",
    gl.VERTEX_SHADER
  );
  var fragmentShader = await createShaderFromScript(
    gl,
    "./raytracing.glsl",
    gl.FRAGMENT_SHADER
  );
  return createProgram(gl, vertexShader, fragmentShader);
}

async function loadImage(filename: string) {
  return new Promise<HTMLImageElement>((resolve) => {
    const img = new Image();
    img.src = `./assets/${filename}`;
    img.onload = () => resolve(img);
  });
}

async function parseScene() {
  const filename =
    new URLSearchParams(location.search).get("file") || "example";
  const input = await (await fetch(`./assets/${filename}.txt`)).text();

  const sc: Scene = {
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

  const points: Array<vec3> = [];
  const normals: Array<vec3> = [];
  const texcoords: Array<vec2> = [];

  let cur_texture: HTMLImageElement | null = null;
  let cur_ior = 1.458;
  let cur_color: vec3 = [1, 1, 1];
  let cur_normal: vec3 = [0, 0, 0];
  let cur_texcoord: vec2 = [0, 0];
  let cur_shininess: vec3 = [0, 0, 0];
  let cur_transparency: vec3 = [0, 0, 0];

  for (let line of input.split("\n")) {
    const [cmd, ...args] = line.trim().split(/\s+/);
    switch (cmd) {
      case "sun": {
        const dir: vec3 = args.map((n) => +n) as vec3;
        sc.lights.push(new DirectionalLight(dir, cur_color));
        break;
      }
      case "bulb": {
        const pos: vec3 = args.map((n) => +n) as vec3;
        sc.lights.push(new PointLight(pos, cur_color));
        break;
      }
      case "color": {
        cur_color = args.map((n) => +n) as vec3;
        break;
      }
      case "xyz": {
        const pos = args.map((n) => +n) as vec3;
        points.push(pos);
        normals.push(cur_normal);
        texcoords.push(cur_texcoord);
        break;
      }
      case "texcoord": {
        cur_texcoord = args.map((n) => +n) as vec2;
        break;
      }
      case "normal": {
        cur_normal = args.map((n) => +n) as vec3;
        break;
      }
      case "trif":
      case "trit": {
        let [i, j, k] = args.map((n) => +n);
        let n = points.length;
        i = i > 0 ? i - 1 : i + n;
        j = j > 0 ? j - 1 : j + n;
        k = k > 0 ? k - 1 : k + n;
        sc.objects.push(
          new Triangle(
            points[i],
            points[j],
            points[k],
            normals[i],
            normals[j],
            normals[k],
            texcoords[i],
            texcoords[j],
            texcoords[k],
            {
              texture: cur_texture,
              color: cur_color,
              shininess: cur_shininess,
              transparency: cur_transparency,
              ior: cur_ior,
            }
          )
        );
        break;
      }
      case "sphere": {
        let [x, y, z, r] = args.map((n) => +n);
        sc.objects.push(
          new Sphere([x, y, z], r, {
            texture: cur_texture,
            color: cur_color,
            shininess: cur_shininess,
            transparency: cur_transparency,
            ior: cur_ior,
          })
        );
        break;
      }
      case "plane": {
        let [a, b, c, d] = args.map((n) => +n);
        sc.objects.push(
          new Plane(a, b, c, d, {
            texture: cur_texture,
            color: cur_color,
            shininess: cur_shininess,
            transparency: cur_transparency,
            ior: cur_ior,
          })
        );
        break;
      }
      case "texture": {
        cur_texture = args[0] == "none" ? null : await loadImage(args[0]);
        break;
      }
      case "eye": {
        sc.eye = args.map((n) => +n) as vec3;
        break;
      }
      case "forward": {
        sc.forward = normalize(args.map((n) => +n) as vec3);
        sc.right = normalize(cross(sc.forward, sc.up));
        sc.up = normalize(cross(sc.right, sc.forward));
        break;
      }
      case "up": {
        sc.up = normalize(args.map((n) => +n) as vec3);
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
          cur_shininess = args.map((n) => +n) as vec3;
        } else {
          let s = +args[0];
          cur_shininess = [s, s, s];
        }
        break;
      }
      case "transparency": {
        if (args.length > 1) {
          cur_transparency = args.map((n) => +n) as vec3;
        } else {
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
  const canvas = document.querySelector("canvas")!;
  const r = devicePixelRatio;
  canvas.width = window.innerWidth * r;
  canvas.height = window.innerHeight * r;
  canvas.style.height = window.innerHeight + "px";
  const gl = canvas.getContext("webgl2", { antialias: true })!;
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
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array(indices),
    gl.STATIC_DRAW
  );

  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.useProgram(program);

  const scene = await parseScene();

  const loc = (name: string) => gl.getUniformLocation(program, name);

  for (let [i, light] of scene.lights.entries()) {
    if (light instanceof DirectionalLight) {
      gl.uniform1i(loc(`scene.lights[${i}].type`), DIRECTIONAL);
      gl.uniform3fv(
        loc(`scene.lights[${i}].directional.dir`),
        new Float32Array(light.dir)
      );
      gl.uniform3fv(
        loc(`scene.lights[${i}].directional.color`),
        new Float32Array(light.color)
      );
    } else {
      gl.uniform1i(loc(`scene.lights[${i}].type`), POINT);
      gl.uniform3fv(
        loc(`scene.lights[${i}].point.pos`),
        new Float32Array(light.pos)
      );
      gl.uniform3fv(
        loc(`scene.lights[${i}].point.color`),
        new Float32Array(light.color)
      );
    }
  }

  let textureCount = 0;

  function loadMaterial(i: number, material: Material) {
    gl.uniform3fv(
      loc(`scene.objects[${i}].mtl.color`),
      new Float32Array(material.color)
    );
    gl.uniform1f(loc(`scene.objects[${i}].mtl.ior`), material.ior);
    gl.uniform3fv(
      loc(`scene.objects[${i}].mtl.shininess`),
      new Float32Array(material.shininess)
    );
    gl.uniform3fv(
      loc(`scene.objects[${i}].mtl.transparency`),
      new Float32Array(material.transparency)
    );
    if (material.texture) {
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + textureCount);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        material.texture
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(loc(`textures[${textureCount}]`), textureCount);
      gl.uniform1i(loc(`scene.objects[${i}].mtl.texture`), textureCount);
      ++textureCount;
    } else {
      gl.uniform1i(loc(`scene.objects[${i}].mtl.texture`), -1);
    }
  }

  for (let [i, obj] of scene.objects.entries()) {
    if (obj instanceof Triangle) {
      gl.uniform1i(loc(`scene.objects[${i}].type`), TRIANGLE);
      gl.uniform3fv(
        loc(`scene.objects[${i}].triangle.p0`),
        new Float32Array(obj.p0)
      );
      gl.uniform3fv(
        loc(`scene.objects[${i}].triangle.p1`),
        new Float32Array(obj.p1)
      );
      gl.uniform3fv(
        loc(`scene.objects[${i}].triangle.p2`),
        new Float32Array(obj.p2)
      );
      gl.uniform3fv(
        loc(`scene.objects[${i}].triangle.n0`),
        new Float32Array(obj.n0)
      );
      gl.uniform3fv(
        loc(`scene.objects[${i}].triangle.n1`),
        new Float32Array(obj.n1)
      );
      gl.uniform3fv(
        loc(`scene.objects[${i}].triangle.n2`),
        new Float32Array(obj.n2)
      );
      gl.uniform3fv(
        loc(`scene.objects[${i}].triangle.e1`),
        new Float32Array(obj.e1)
      );
      gl.uniform3fv(
        loc(`scene.objects[${i}].triangle.e2`),
        new Float32Array(obj.e2)
      );
      gl.uniform2fv(
        loc(`scene.objects[${i}].triangle.st0`),
        new Float32Array(obj.st0)
      );
      gl.uniform2fv(
        loc(`scene.objects[${i}].triangle.st1`),
        new Float32Array(obj.st1)
      );
      gl.uniform2fv(
        loc(`scene.objects[${i}].triangle.st2`),
        new Float32Array(obj.st2)
      );
    } else if (obj instanceof Sphere) {
      gl.uniform1i(loc(`scene.objects[${i}].type`), SPHERE);
      gl.uniform3fv(
        loc(`scene.objects[${i}].sphere.c`),
        new Float32Array(obj.c)
      );
      gl.uniform1f(loc(`scene.objects[${i}].sphere.r`), obj.r);
    } else if (obj instanceof Plane) {
      gl.uniform1i(loc(`scene.objects[${i}].type`), PLANE);
      gl.uniform1f(loc(`scene.objects[${i}].plane.a`), obj.a);
      gl.uniform1f(loc(`scene.objects[${i}].plane.b`), obj.b);
      gl.uniform1f(loc(`scene.objects[${i}].plane.c`), obj.c);
      gl.uniform1f(loc(`scene.objects[${i}].plane.d`), obj.d);
    }
    loadMaterial(i, obj.mtl);
  }

  gl.uniform2fv(
    loc(`viewport`),
    new Float32Array([canvas.width, canvas.height])
  );
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

  const keydown: Record<string, boolean> = {};
  window.onkeydown = (e) => {
    keydown[e.key] = true;
  };
  window.onkeyup = (e) => {
    keydown[e.key] = false;
  };

  function rotate(e1: vec3, e2: vec3, theta: float): [vec3, vec3] {
    return [
      add(mul(e1, Math.cos(theta)), mul(e2, Math.sin(theta))),
      add(mul(e1, -Math.sin(theta)), mul(e2, Math.cos(theta))),
    ];
  }

  let prev = -1;
  function updateCamera(t: DOMHighResTimeStamp) {
    if (prev < 0) prev = t;
    const d_x = 0.001 * (t - prev);
    const d_theta = 0.001 * (t - prev);
    prev = t;

    if (keydown["w"]) {
      scene.eye = add(scene.eye, mul(scene.forward, d_x));
    }
    if (keydown["s"]) {
      scene.eye = add(scene.eye, mul(scene.forward, -d_x));
    }
    if (keydown["a"]) {
      scene.eye = add(scene.eye, mul(scene.right, -d_x));
    }
    if (keydown["d"]) {
      scene.eye = add(scene.eye, mul(scene.right, d_x));
    }
    if (keydown["r"]) {
      scene.eye = add(scene.eye, mul(scene.up, d_x));
    }
    if (keydown["f"]) {
      scene.eye = add(scene.eye, mul(scene.up, -d_x));
    }
    if (keydown["ArrowLeft"]) {
      [scene.right, scene.forward] = rotate(
        scene.right,
        scene.forward,
        d_theta
      );
    }
    if (keydown["ArrowRight"]) {
      [scene.right, scene.forward] = rotate(
        scene.right,
        scene.forward,
        -d_theta
      );
    }
    if (keydown["ArrowUp"]) {
      [scene.forward, scene.up] = rotate(scene.forward, scene.up, d_theta);
    }
    if (keydown["ArrowDown"]) {
      [scene.forward, scene.up] = rotate(scene.forward, scene.up, -d_theta);
    }
    if (keydown["q"]) {
      [scene.right, scene.up] = rotate(scene.right, scene.up, d_theta);
    }
    if (keydown["e"]) {
      [scene.right, scene.up] = rotate(scene.right, scene.up, -d_theta);
    }
  }

  function render(time: DOMHighResTimeStamp) {
    updateCamera(time);

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
