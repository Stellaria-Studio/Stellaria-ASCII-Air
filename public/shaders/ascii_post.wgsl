@binding(0) @group(0) var sourceTexture_0 : texture_2d<f32>;

@binding(1) @group(0) var sourceSampler_0 : sampler;

struct VertexOut_0
{
    @builtin(position) position_0 : vec4<f32>,
    @location(0) uv_0 : vec2<f32>,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexId_0 : u32) -> VertexOut_0
{
    var position_1 : vec2<f32>;
    if(vertexId_0 == u32(0))
    {
        position_1 = vec2<f32>(-1.0f, -1.0f);
    }
    else
    {
        if(vertexId_0 == u32(1))
        {
            position_1 = vec2<f32>(3.0f, -1.0f);
        }
        else
        {
            position_1 = vec2<f32>(-1.0f, 3.0f);
        }
    }
    var output_0 : VertexOut_0;
    output_0.position_0 = vec4<f32>(position_1, 0.0f, 1.0f);
    output_0.uv_0 = vec2<f32>(position_1.x * 0.5f + 0.5f, 0.5f - position_1.y * 0.5f);
    return output_0;
}

struct pixelOutput_0
{
    @location(0) output_1 : vec4<f32>,
};

struct pixelInput_0
{
    @location(0) uv_1 : vec2<f32>,
};

@fragment
fn fragmentMain( _S1 : pixelInput_0, @builtin(position) position_2 : vec4<f32>) -> pixelOutput_0
{
    var source_0 : vec3<f32> = (textureSample((sourceTexture_0), (sourceSampler_0), (_S1.uv_1))).xyz;
    var centered_0 : vec2<f32> = _S1.uv_1 * vec2<f32>(2.0f) - vec2<f32>(1.0f);
    var _S2 : f32 = max(dot(source_0, vec3<f32>(0.2125999927520752f, 0.71520000696182251f, 0.07220000028610229f)), source_0.y * 0.92000001668930054f);
    var _S3 : pixelOutput_0 = pixelOutput_0( vec4<f32>(mix(vec3<f32>(_S2 * 0.2800000011920929f, _S2, _S2 * 0.56999999284744263f), source_0 * vec3<f32>(1.05999994277954102f), vec3<f32>(saturate((source_0.x - source_0.z - 0.03500000014901161f) * 3.20000004768371582f))) * vec3<f32>((0.92000001668930054f + 0.07999999821186066f * sin(position_2.y * 3.14159274101257324f))) * vec3<f32>(saturate(1.04999995231628418f - dot(centered_0, centered_0) * 0.23999999463558197f)), 1.0f) );
    return _S3;
}
