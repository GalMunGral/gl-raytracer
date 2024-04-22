#version 300 es

in vec2 ndcCoord;

void main() { gl_Position = vec4(ndcCoord, 0.0, 1.0); }
