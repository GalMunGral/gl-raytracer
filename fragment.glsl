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

float rand(inout int next)
{
    next = next * 1103515245 + 12345; // TODO: overflow?
    return float((next / 65536) % 32768) / 32767.0;
}

vec2 sample_unit_disk(inout int next)
{
    vec2 q;
    do
    {
        q = vec2(2.0 * rand(next) - 1.0, 2.0 * rand(next) - 1.0);
    } while (length(q) >= 1.0);
    return q;
}

vec3 sample_unit_sphere(inout int next)
{
    vec3 q;
    do
    {
        q = vec3(
            2.0 * rand(next) - 1.0, 
            2.0 * rand(next) - 1.0, 
            2.0 * rand(next) - 1.0
        );
    } while (length(q) >= 1.0);
    return q;
}

float gamma(float l, float exposure)
{
    if (exposure == 0.0) return l;
    l = clamp(l, 0.0f, 1.0f);
    l = 1.0 - exp(-l * exposure);
    return l <= 0.0031308 ? 12.92 * l : 1.055 * pow(l, 1.0 / 2.4) - 0.055;
}


struct DirectionalLight
{
    vec3 dir;
    vec3 color;
};

struct PointLight 
{
    vec3 pos;
    vec3 color;
};

struct Light
{
    int type;
    DirectionalLight directional;
    PointLight point;
};

struct Triangle
{
  vec3 p0, p1, p2, n0, n1, n2, e1, e2;
  vec2 st0, st1, st2;
};

struct Sphere
{
  vec3 c;
  float r;
};

struct Plane
{
    float a, b, c, d;
};

struct Material
{
    vec3 shininess, transparency;
    float ior;
    int texture;
    vec3 color;
};

struct Object
{
    int type;
    Triangle triangle;
    Sphere sphere;
    Plane plane;
    Material material;
};

struct Scene
{
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


vec4 sample_texture(int index, vec2 st)
{
    switch (index) {
    case 0:
        return texture(textures[0], st);
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

float intersect(Triangle obj, vec3 o, vec3 dir)
{
    vec3 n = cross(obj.p1 - obj.p0, obj.p2 - obj.p0);
    float t = dot(obj.p0 - o, n) / dot(dir, n);
    if (t < 0.0) return 0.0;

    vec3 p = o + t * dir;
    float b1 = dot(p - obj.p0, obj.e1);
    float b2 = dot(p - obj.p0, obj.e2);
    float b0 = 1.0 - b1 - b2;
    if (b0 < 0.0 || b1 < 0.0 || b2 < 0.0) return 0.0;

    return t;
}

vec3 norm_at(Triangle obj, vec3 p)
{
    float b1 = dot(p - obj.p0, obj.e1);
    float b2 = dot(p - obj.p0, obj.e2);
    float b0 = 1.0 - b1 - b2;
    return normalize(b0 * obj.n0 + b1 * obj.n1 + b2 * obj.n2);
}

vec3 color_at(Triangle obj, vec3 p, Material mtl)
{
    if (mtl.texture != -1)
    {
        float b1 = dot(p - obj.p0, obj.e1);
        float b2 = dot(p - obj.p0, obj.e2);
        float b0 = 1.0 - b1 - b2;
        vec2 st = b0 * obj.st0 + b1 * obj.st1 + b2 * obj.st2;
        return sample_texture(mtl.texture, st).rgb;
    }
    return mtl.color;
}

float intersect(Sphere obj, vec3 o, vec3 dir)
{
    bool inside = length(obj.c - o) < obj.r;
    float t_center = dot(obj.c - o, dir);
    if (!inside && t_center < 0.0) return 0.0;

    float d = length(o + (t_center * dir) - obj.c);
    if (!inside && obj.r < d) return 0.0;

    float t_offset = sqrt(obj.r * obj.r - d * d);
    return inside ? t_center + t_offset : t_center - t_offset;
}

vec3 norm_at(Sphere obj, vec3 p)
{
    return normalize(p - obj.c);
}

vec3 color_at(Sphere obj, vec3 p, Material mtl)
{
    if (mtl.texture != -1)
    {
        float dx = p.x - obj.c.x;
        float dy = p.y - obj.c.y;
        float dz = p.z - obj.c.z;
        float s = (atan(-dz, dx) + M_PI) / (2.0 * M_PI);
        float t = atan(sqrt(dx * dx + dz * dz), dy) / M_PI;
        if (s > 1.0) s -= 1.0;
        return sample_texture(mtl.texture, vec2(s, t)).rgb;
    }
    return mtl.color;
}

float intersect(Plane obj, vec3 o, vec3 dir)
{
    vec3 p =  obj.a != 0.0 
        ? vec3(-obj.d / obj.a, 0.0, 0.0)
        : obj.b != 0.0 
            ? vec3(0.0, -obj.d / obj.b, 0.0)
            : vec3(0.0, 0.0, -obj.d / obj.c);
    vec3 n = vec3(obj.a, obj.b, obj.c);
    float t = dot(p - o, n) / dot(dir, n);
    return max(t, 0.0);
}

vec3 norm_at(Plane obj, vec3 p)
{
    return normalize(vec3(obj.a, obj.b, obj.c));
}

vec3 color_at(Plane obj, vec3 p, Material mtl)
{
    return mtl.color;
}

float intersect(Object obj, vec3 o, vec3 dir)
{
    /**
     * Advance the ray by a small offset to compensate for numerical errors.
     * There are two cases where this is necessary:
     *  - when doing shadow testing, we need to start from outside the object.
     *  - when computing refraction, we need to start from inside the object.
     */
    o += 1e-3 * dir;
    switch (obj.type)
    {
        case TRIANGLE: 
            return intersect(obj.triangle, o, dir);
        case SPHERE: 
            return intersect(obj.sphere, o, dir);
        case PLANE:
            return intersect(obj.plane, o, dir);
    }
}

vec3 norm_at(Object obj, vec3 p)
{
    switch (obj.type)
    {
        case TRIANGLE: 
            return norm_at(obj.triangle, p);
        case SPHERE: 
            return norm_at(obj.sphere, p);
        case PLANE:
            return norm_at(obj.plane, p);
    }
}

vec3 color_at(Object obj, vec3 o)
{
    switch (obj.type)
    {
        case TRIANGLE: 
            return color_at(obj.triangle, o, obj.material);
        case SPHERE: 
            return color_at(obj.sphere, o, obj.material);
        case PLANE:
            return color_at(obj.plane, o, obj.material);
    }
}

vec3 light_dir(DirectionalLight l, vec3 o)
{

  return normalize(l.dir);
}

float light_dist(DirectionalLight l, vec3 o)
{
    return FLT_MAX;
}

vec3 intensity(DirectionalLight l, vec3 o)
{
    return l.color;
}

vec3 light_dir(PointLight l, vec3 o)
{
    return normalize(l.pos - o);
}

float light_dist(PointLight l, vec3 o)
{
    return length(l.pos - o);
}

vec3 intensity(PointLight l, vec3 o)
{
    float d = light_dist(l, o);
    return l.color * min(100.0, 1.0 / (d * d));
}


vec3 light_dir(Light l, vec3 o)
{
    switch (l.type)
    {
        case DIRECTIONAL:
            return light_dir(l.directional, o);
        case POINT:
            return light_dir(l.point, o);
    }
}

float light_dist(Light l, vec3 o)
{
    switch (l.type)
    {
        case DIRECTIONAL:
            return light_dist(l.directional, o);
        case POINT:
            return light_dist(l.point, o);
    }
}

vec3 intensity(Light l, vec3 o)
{
    switch (l.type)
    {
        case DIRECTIONAL:
            return intensity(l.directional, o);
        case POINT:
            return intensity(l.point, o);
    }
}


const Object NULL = Object(
    4,
    Triangle(
        vec3(0.0), vec3(0.0), vec3(0.0), 
        vec3(0.0), vec3(0.0), vec3(0.0), 
        vec3(0.0), vec3(0.0), 
        vec2(0.0), vec2(0.0), vec2(0.0)
    ),
    Sphere(vec3(0.0), 0.0),
    Plane(0.0, 0.0, 0.0, 0.0),
    Material(vec3(0.0), vec3(0.0), 0.0, -1, vec3(0.0))
);

struct RayTraceArgs
{
    vec3 o, dir;
    int d, bounces;
};

struct RayTraceRet
{
    Object obj;
    vec3 p, intensity;
};

struct StackFrame
{
    RayTraceArgs args;
    RayTraceRet ret;
    vec3 n;
    vec3 diffuse, refraction, reflection;
    RayTraceArgs next_args;
    RayTraceRet next_ret;
    int cont;
};

Object advance_ray(vec3 o, vec3 dir)
{
    Object obj_hit;
    float t_hit = FLT_MAX;
    for (int i = 0; i < num_objects; ++i)
    {
        Object obj = scene.objects[i];
        float t = intersect(obj, o, dir);
        if (t > 0.0 && t < t_hit)
        {
            obj_hit = obj;
            t_hit = t;
        }
    }
    return obj_hit;
}


vec3 illuminate(Light light, Object obj, vec3 p, vec3 n)
{
    vec3 l_dir = light_dir(light, p);
    float l_dist = light_dist(light, p);

    Object obj_hit = advance_ray(p, l_dir);
    if (obj_hit.type != NONE && intersect(obj_hit, p, l_dir) < l_dist) 
    {
        return vec3(0.0); // in shadoAw
    }

    float lambert = max(0.0, dot(l_dir, n));
    vec3 color = lambert * intensity(light, p) * color_at(obj, p);
    return color;
}

void ray_trace_0(inout StackFrame sf, inout int next) { 
    vec3 o = sf.args.o;
    vec3 dir = sf.args.dir;

    Object obj_hit = advance_ray(o, dir);
    sf.ret.obj = obj_hit;

    if (obj_hit.type == NONE)
    {
        sf.ret.intensity = vec3(0.0);
        sf.cont = -1;
        return;
    }
 
    float t_hit = intersect(obj_hit, o, dir);
    sf.ret.p = o + t_hit * dir;
    sf.n = norm_at(obj_hit, sf.ret.p);

    /* use the other side */
    if (dot(sf.n, dir) > 0.0)
    {
        sf.n = -sf.n;
    }

    for (int i = 0; i < num_lights; ++i)
    {
        sf.diffuse += illuminate(scene.lights[i], sf.ret.obj, sf.ret.p, sf.n);
    }

    if (sf.args.d > 0)
    {
        /* shoot secondary rays */
        vec3 random_dir = normalize(sf.n + sample_unit_sphere(next));
        sf.next_args = RayTraceArgs(
            sf.ret.p, 
            random_dir, 
            max(sf.args.d - 1, 0), 
            max(sf.args.bounces - 0, 0)
        );
        sf.cont = 11;
        return;
    }
    
    sf.cont = 2;
}

void ray_trace_1(inout StackFrame sf, inout int next) {
    if (sf.next_ret.obj.type != NONE)
    {
        Light l = Light(
            POINT,
            DirectionalLight(vec3(0.0), vec3(0.0)),
            PointLight(sf.next_ret.p, sf.next_ret.intensity)
        );
        sf.diffuse += illuminate(l, sf.ret.obj, sf.ret.p, sf.n);
    }
    sf.cont = 2;
}

void ray_trace_2(inout StackFrame sf, inout int next) {
    vec3 dir = sf.args.dir, n = sf.n;
    if (sf.args.bounces > 0) 
    {
        /* reflection */
        vec3 r = normalize(dir - 2.0 * dot(dir, n) * n);
        sf.next_args = RayTraceArgs(
            sf.ret.p, 
            r, 
            max(sf.args.d - 1, 0), 
            max(sf.args.bounces - 1, 0)
        );
        sf.cont = 13;
        return;
    }
    sf.cont = 4;
}

void ray_trace_3(inout StackFrame sf, inout int next) {
    sf.reflection = sf.next_ret.intensity;
    sf.cont = 4;
}

void ray_trace_4(inout StackFrame sf, inout int next) {
    vec3 dir = sf.args.dir, n = sf.n;

    if (sf.args.bounces > 0)
    {
        Material mtl = sf.ret.obj.material;

        /* refraction */
        bool entering = dot(dir, norm_at(sf.ret.obj, sf.ret.p)) < 0.0;
        float eta = entering ? 1.0 / mtl.ior : mtl.ior;
        float k = 1.0 - pow(eta, 2.0) * (1.0 - dot(n, dir) * dot(n, dir));

        if (k < 0.0)
        {
            sf.refraction = sf.reflection;
        }
        else
        {
            vec3 r = normalize(eta * dir - (eta * dot(n, dir) + sqrt(k)) * n);
            sf.next_args = RayTraceArgs(
                sf.ret.p + 0.01 * r, 
                r, 
                max(sf.args.d - 1, 0), 
                max(sf.args.bounces - 1, 0)
            );
            sf.cont = 15;
            return;
        }
    }
    sf.cont = 6;
}

void ray_trace_5(inout StackFrame sf, inout int next) {
    sf.refraction = sf.next_ret.intensity;
    sf.cont = 6;
}


void ray_trace_6(inout StackFrame sf, int sp, inout int next) {
    Material mtl = sf.ret.obj.material;
    vec3 s = mtl.shininess;
    vec3 t = mtl.transparency;
    sf.ret.intensity = (
        s * sf.reflection +
        (vec3(1.0, 1.0, 1.0) - s) * t * sf.refraction +
        (vec3(1.0, 1.0, 1.0) - s) * (vec3(1.0, 1.0, 1.0) - t) * sf.diffuse
    );
    sf.cont = -1;
}

out vec4 fragColor;
 
#define STACK_MAX_N 10 

void main() {
    StackFrame stack[STACK_MAX_N];
    int sp = 0;

    float w = viewport.x;
    float h = viewport.y;

    int next = int((gl_FragCoord.z * viewport.y + gl_FragCoord.y) * viewport.x + gl_FragCoord.x);

    bool hit_any = false;
    vec3 c = vec3(0.0);

    for (int k = 0; k < scene.aa; ++k)
    {
        vec3 origin = scene.eye;
        vec3 forward = scene.forward;
        float x = gl_FragCoord.x + rand(next);
        float y = gl_FragCoord.y + rand(next);
        float sx = (2.0 * x - w) / max(w, h);
        float sy = (2.0 * y - h) / max(w, h);

        if (scene.fisheye)
        {
          sx /= length(scene.forward);
          sy /= length(scene.forward);
          float r2 = (sx * sx + sy * sy);
          if (r2 > 1.0) return;
          forward = sqrt(1.0 - r2) * normalize(forward);
        }

        vec3 dir = normalize(forward + sx * scene.right + sy * scene.up);

        if (scene.dof)
        {
            vec3 focal_point = scene.eye + scene.focus * dir;
            vec2 offset = scene.lens * sample_unit_disk(next);
            origin += offset.x * scene.right + offset.y * scene.up;
            dir = normalize(focal_point - origin);
        }

        stack[0].cont = 0;
        stack[0].args = RayTraceArgs(origin, dir, scene.d, scene.bounces);

        #define INIT_STACK_FRAME \
            stack[sp].diffuse = vec3(0.0); \
            stack[sp].reflection = vec3(0.0); \
            stack[sp].refraction = vec3(0.0);

        #define RECURSIVE_CALL \
            stack[sp + 1].args = stack[sp].next_args; \
            ++sp; \
            stack[sp].cont = 0;

        #define RETURN \
            stack[sp - 1].next_ret = stack[sp].ret; \
            --sp;

        while (true) {
            if (stack[sp].cont == -1) {
                if (sp == 0) break;
                RETURN
                continue;
            }
            switch (stack[sp].cont) {
                case 0:
                    INIT_STACK_FRAME
                    ray_trace_0(stack[sp], next);
                    break;
                case 1:
                    ray_trace_1(stack[sp], next);
                    break;
                case 2:
                    ray_trace_2(stack[sp], next);
                    break;
                case 3:
                    ray_trace_3(stack[sp], next);
                    break;
                case 4:
                    ray_trace_4(stack[sp], next);
                    break;
                case 5:
                    ray_trace_5(stack[sp], next);
                    break;
                case 6:
                    ray_trace_6(stack[sp], sp, next);
                    break;
                case 11:
                    stack[sp].cont = 1;
                    RECURSIVE_CALL
                    break;
                case 13:
                    stack[sp].cont = 3;
                    RECURSIVE_CALL
                    break;
                case 15:
                    stack[sp].cont = 5;
                    RECURSIVE_CALL
                    break;
            }
        }


        if (stack[0].ret.obj.type != NONE)
        {
          hit_any = true;
          c += stack[0].ret.intensity / float(scene.aa);
        }
    }

    if (hit_any)
    {
      fragColor.r = gamma(c.r, scene.expose);
      fragColor.g = gamma(c.g, scene.expose);
      fragColor.b = gamma(c.b, scene.expose);
      fragColor.a = 1.0;
    }
}