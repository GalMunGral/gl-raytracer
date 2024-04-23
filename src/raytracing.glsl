#version 300 es
precision mediump float;

#define FLT_MAX 3.402823466e+38
#define M_PI 3.1415926535897932384626433832795

#define MAX_OBJ_N 20
#define MAX_LIGHT_N 5
#define MAX_TEXTURE_N 5

#define DIRECTIONAL 1
#define POINT 2

#define NONE 0
#define TRIANGLE 1
#define SPHERE 2
#define PLANE 3

float rand(inout int next) {
  next = next * 1103515245 + 12345; // TODO: overflow?
  return float((next / 65536) % 32768) / 32767.0;
}

vec2 sample_unit_disk(inout int next) {
  vec2 q;
  do {
    q = vec2(2.0 * rand(next) - 1.0, 2.0 * rand(next) - 1.0);
  } while (length(q) >= 1.0);
  return q;
}

vec3 sample_unit_sphere(inout int next) {
  vec3 q;
  do {
    q = vec3(2.0 * rand(next) - 1.0, 2.0 * rand(next) - 1.0,
             2.0 * rand(next) - 1.0);
  } while (length(q) >= 1.0);
  return q;
}

float gamma(float l, float exposure) {
  if (exposure == 0.0)
    return l;
  l = clamp(l, 0.0f, 1.0f);
  l = 1.0 - exp(-l * exposure);
  return l <= 0.0031308 ? 12.92 * l : 1.055 * pow(l, 1.0 / 2.4) - 0.055;
}

struct DirectionalLight {
  vec3 dir;
  vec3 color;
};

struct PointLight {
  vec3 pos;
  vec3 color;
};

struct Light {
  int type;
  DirectionalLight directional;
  PointLight point;
};

struct Triangle {
  vec3 p0, p1, p2, n0, n1, n2, e1, e2;
  vec2 st0, st1, st2;
};

struct Sphere {
  vec3 c;
  float r;
};

struct Plane {
  float a, b, c, d;
};

struct Material {
  vec3 shininess, transparency;
  float ior;
  int texture;
  vec3 color;
};

struct Object {
  int type;
  Triangle triangle;
  Sphere sphere;
  Plane plane;
  Material mtl;
};

struct Scene {
  Light lights[MAX_OBJ_N];
  Object objects[MAX_OBJ_N];

  int aa, d, bounces;
  float expose, focus, lens;
  vec3 eye, forward, right, up;
  bool fisheye, dof;
};

uniform vec2 viewport;
uniform int num_objects;
uniform int num_lights;
uniform Scene scene;
uniform sampler2D textures[MAX_TEXTURE_N];

vec4 sample_texture(int index, vec2 st) {
  switch (index) {
  case 1:
    return texture(textures[1], st);
  case 2:
    return texture(textures[2], st);
  case 3:
    return texture(textures[3], st);
  default:
    return texture(textures[0], st);
  }
}

float intersect(Object obj, vec3 o, vec3 dir) {
  /**
   * Advance the ray by a small offset to compensate for numerical errors.
   * There are two cases where this is necessary:
   *  - when doing shadow testing, we need to start from outside the object.
   *  - when computing refraction, we need to start from inside the object.
   */
  o += 1e-3 * dir;
  switch (obj.type) {
  case TRIANGLE: {
    Triangle tri = obj.triangle;
    vec3 n = cross(tri.p1 - tri.p0, tri.p2 - tri.p0);
    float t = dot(tri.p0 - o, n) / dot(dir, n);
    if (t < 0.0)
      return 0.0;
    vec3 p = o + t * dir;
    float b1 = dot(p - tri.p0, tri.e1);
    float b2 = dot(p - tri.p0, tri.e2);
    float b0 = 1.0 - b1 - b2;
    if (b0 < 0.0 || b1 < 0.0 || b2 < 0.0)
      return 0.0;
    return t;
  }
  case SPHERE: {
    Sphere s = obj.sphere;
    bool inside = length(s.c - o) < s.r;
    float t_center = dot(s.c - o, dir);
    if (!inside && t_center < 0.0)
      return 0.0;
    float d = length(o + (t_center * dir) - s.c);
    if (!inside && s.r < d)
      return 0.0;
    float t_offset = sqrt(s.r * s.r - d * d);
    return inside ? t_center + t_offset : t_center - t_offset;
  }
  case PLANE: {
    float a = obj.plane.a, b = obj.plane.b, c = obj.plane.c, d = obj.plane.d;
    vec3 p = a != 0.0   ? vec3(-d / a, 0.0, 0.0)
             : b != 0.0 ? vec3(0.0, -d / b, 0.0)
                        : vec3(0.0, 0.0, -d / c);
    vec3 n = vec3(a, b, c);
    float t = dot(p - o, n) / dot(dir, n);
    return max(t, 0.0);
  }
  }
}

vec3 norm_at(Object obj, vec3 p) {
  switch (obj.type) {
  case TRIANGLE: {
    Triangle t = obj.triangle;
    float b1 = dot(p - t.p0, t.e1);
    float b2 = dot(p - t.p0, t.e2);
    float b0 = 1.0 - b1 - b2;
    return normalize(b0 * t.n0 + b1 * t.n1 + b2 * t.n2);
  }
  case SPHERE: {
    return normalize(p - obj.sphere.c);
  }
  case PLANE: {
    return normalize(vec3(obj.plane.a, obj.plane.b, obj.plane.c));
  }
  }
}

vec3 color_at(Object obj, vec3 p) {
  switch (obj.type) {
  case TRIANGLE: {
    Triangle t = obj.triangle;
    if (obj.mtl.texture != -1) {
      float b1 = dot(p - t.p0, t.e1);
      float b2 = dot(p - t.p0, t.e2);
      float b0 = 1.0 - b1 - b2;
      vec2 st = b0 * t.st0 + b1 * t.st1 + b2 * t.st2;
      return sample_texture(obj.mtl.texture, st).rgb;
    }
    return obj.mtl.color;
  }
  case SPHERE: {
    Sphere s = obj.sphere;
    if (obj.mtl.texture != -1) {
      float dx = p.x - s.c.x;
      float dy = p.y - s.c.y;
      float dz = p.z - s.c.z;
      float s = (atan(-dz, dx) + M_PI) / (2.0 * M_PI);
      float t = atan(sqrt(dx * dx + dz * dz), dy) / M_PI;
      if (s > 1.0)
        s -= 1.0;
      return sample_texture(obj.mtl.texture, vec2(s, t)).rgb;
    }
    return obj.mtl.color;
  }
  case PLANE: {
    return obj.mtl.color;
  }
  }
}

vec3 light_dir(Light l, vec3 o) {
  switch (l.type) {
  case DIRECTIONAL:
    return normalize(l.directional.dir);
  case POINT:
    return normalize(l.point.pos - o);
  }
}

float light_dist(Light l, vec3 o) {
  switch (l.type) {
  case DIRECTIONAL:
    return FLT_MAX;
  case POINT:
    return length(l.point.pos - o);
  }
}

vec3 intensity(Light l, vec3 o) {
  switch (l.type) {
  case DIRECTIONAL:
    return l.directional.color;
  case POINT: {
    float d = light_dist(l, o);
    return l.point.color * min(100.0, 1.0 / (d * d));
  }
  }
}

const Object NULL = Object(4,
                           Triangle(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0),
                                    vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0),
                                    vec2(0.0), vec2(0.0), vec2(0.0)),
                           Sphere(vec3(0.0), 0.0), Plane(0.0, 0.0, 0.0, 0.0),
                           Material(vec3(0.0), vec3(0.0), 0.0, -1, vec3(0.0)));

struct RayTraceArgs {
  vec3 o, dir;
  int d, bounces;
};

struct StackFrame {
  RayTraceArgs args;
  int cont;
  int obj_id;
  vec3 p, n;
  vec3 diffuse, refraction, reflection, intensity;
};

struct HitResult {
  int obj_id;
  float t_hit;
};

HitResult advance_ray(vec3 o, vec3 dir) {
  int obj_id = -1;
  float t_hit = FLT_MAX;
  for (int i = 0; i < num_objects; ++i) {
    float t = intersect(scene.objects[i], o, dir);
    if (t > 0.0 && t < t_hit) {
      obj_id = i;
      t_hit = t;
    }
  }
  return HitResult(obj_id, t_hit);
}

vec3 illuminate(Light light, Object obj, vec3 p, vec3 n) {
  vec3 l_dir = light_dir(light, p);
  float l_dist = light_dist(light, p);

  HitResult res = advance_ray(p, l_dir);
  if (res.obj_id != -1 && res.t_hit < l_dist) {
    return vec3(0.0); // in shadoAw
  }

  float lambert = max(0.0, dot(l_dir, n));
  vec3 color = lambert * intensity(light, p) * color_at(obj, p);
  return color;
}

out vec4 fragColor;

#define STACK_MAX_N 4

void main() {
  StackFrame stack[STACK_MAX_N];
  int sp = 0;

  float w = viewport.x;
  float h = viewport.y;

  int next = int((gl_FragCoord.z * viewport.y + gl_FragCoord.y) * viewport.x +
                 gl_FragCoord.x);

  vec4 c = vec4(0.0);

  for (int k = 0; k < scene.aa; ++k) {
    vec3 origin = scene.eye;
    vec3 forward = scene.forward;
    float x = gl_FragCoord.x + rand(next);
    float y = gl_FragCoord.y + rand(next);
    float sx = (2.0 * x - w) / max(w, h);
    float sy = (2.0 * y - h) / max(w, h);

    if (scene.fisheye) {
      sx /= length(scene.forward);
      sy /= length(scene.forward);
      float r2 = (sx * sx + sy * sy);
      if (r2 > 1.0)
        return;
      forward = sqrt(1.0 - r2) * normalize(forward);
    }

    vec3 dir = normalize(forward + sx * scene.right + sy * scene.up);

    if (scene.dof) {
      vec3 focal_point = scene.eye + scene.focus * dir;
      vec2 offset = scene.lens * sample_unit_disk(next);
      origin += offset.x * scene.right + offset.y * scene.up;
      dir = normalize(focal_point - origin);
    }

    stack[0].cont = 0;
    stack[0].args = RayTraceArgs(origin, dir, scene.d, scene.bounces);

    while (sp > -1) {
      switch (stack[sp].cont) {
      case 0: {
        stack[sp].diffuse = vec3(0.0);
        stack[sp].reflection = vec3(0.0);
        stack[sp].refraction = vec3(0.0);

        vec3 o = stack[sp].args.o;
        vec3 dir = stack[sp].args.dir;

        HitResult res = advance_ray(o, dir);
        stack[sp].obj_id = res.obj_id;

        if (res.obj_id == -1) {
          stack[sp].intensity = vec3(0.0);
          --sp;
          break;
        }
        stack[sp].p = o + res.t_hit * dir;
        stack[sp].n = norm_at(scene.objects[res.obj_id], stack[sp].p);

        /* use the other side */
        if (dot(stack[sp].n, dir) > 0.0) {
          stack[sp].n = -stack[sp].n;
        }

        for (int i = 0; i < num_lights; ++i) {
          stack[sp].diffuse +=
              illuminate(scene.lights[i], scene.objects[stack[sp].obj_id],
                         stack[sp].p, stack[sp].n);
        }

        if (stack[sp].args.d > 0) {
          /* shoot secondary rays */
          vec3 random_dir = normalize(stack[sp].n + sample_unit_sphere(next));
          stack[sp].cont = 1;
          stack[sp + 1].args = RayTraceArgs(stack[sp].p, random_dir,
                                            max(stack[sp].args.d - 1, 0),
                                            max(stack[sp].args.bounces - 0, 0));
          ++sp;
          stack[sp].cont = 0;
          break;
        }

        stack[sp].cont = 2;
        break;
      }
      case 1: {
        if (stack[sp + 1].obj_id != -1) {
          Light l = Light(POINT, DirectionalLight(vec3(0.0), vec3(0.0)),
                          PointLight(stack[sp + 1].p, stack[sp + 1].intensity));
          stack[sp].diffuse += illuminate(l, scene.objects[stack[sp].obj_id],
                                          stack[sp].p, stack[sp].n);
        }
        stack[sp].cont = 2;
        break;
      }
      case 2: {
        vec3 dir = stack[sp].args.dir, n = stack[sp].n;
        if (stack[sp].args.bounces > 0) {
          /* reflection */
          vec3 r = normalize(dir - 2.0 * dot(dir, n) * n);
          stack[sp].cont = 3;
          stack[sp + 1].args =
              RayTraceArgs(stack[sp].p, r, max(stack[sp].args.d - 1, 0),
                           max(stack[sp].args.bounces - 1, 0));
          ++sp;
          stack[sp].cont = 0;
          break;
        }
        stack[sp].cont = 4;
        break;
      }
      case 3: {
        stack[sp].reflection = stack[sp + 1].intensity;
        stack[sp].cont = 4;
        break;
      }
      case 4: {
        vec3 dir = stack[sp].args.dir, n = stack[sp].n;

        if (stack[sp].args.bounces > 0) {
          Object obj = scene.objects[stack[sp].obj_id];
          Material mtl = obj.mtl;

          /* refraction */
          bool entering = dot(dir, norm_at(obj, stack[sp].p)) < 0.0;
          float eta = entering ? 1.0 / mtl.ior : mtl.ior;
          float k = 1.0 - pow(eta, 2.0) * (1.0 - dot(n, dir) * dot(n, dir));

          if (k < 0.0) {
            stack[sp].refraction = stack[sp].reflection;
          } else {
            vec3 r = normalize(eta * dir - (eta * dot(n, dir) + sqrt(k)) * n);
            stack[sp].cont = 5;
            stack[sp + 1].args = RayTraceArgs(
                stack[sp].p + 0.01 * r, r, max(stack[sp].args.d - 1, 0),
                max(stack[sp].args.bounces - 1, 0));
            ++sp;
            stack[sp].cont = 0;
            break;
          }
        }
        stack[sp].cont = 6;
        break;
      }
      case 5: {
        stack[sp].refraction = stack[sp + 1].intensity;
        stack[sp].cont = 6;
        break;
      }
      case 6: {
        Material mtl = scene.objects[stack[sp].obj_id].mtl;
        vec3 s = mtl.shininess;
        vec3 t = mtl.transparency;
        stack[sp].intensity =
            (s * stack[sp].reflection +
             (vec3(1.0, 1.0, 1.0) - s) * t * stack[sp].refraction +
             (vec3(1.0, 1.0, 1.0) - s) * (vec3(1.0, 1.0, 1.0) - t) *
                 stack[sp].diffuse);
        --sp;
        break;
      }
      }
    }

    if (stack[0].obj_id != -1) {
      c.rgb += stack[0].intensity / float(scene.aa);
      c.a = 1.0;
    }
  }

  fragColor.r = gamma(c.r, scene.expose);
  fragColor.g = gamma(c.g, scene.expose);
  fragColor.b = gamma(c.b, scene.expose);
  fragColor.a = c.a;
}