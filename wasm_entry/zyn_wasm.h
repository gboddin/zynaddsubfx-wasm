#ifndef ZYN_WASM_H
#define ZYN_WASM_H

#include <emscripten.h>
#include <cstdint>

extern "C" {

/**
 * @brief Initializes the ZynAddSubFX engine.
 * @param sample_rate The sampling rate of the audio context.
 */
EMSCRIPTEN_KEEPALIVE void zyn_init(int sample_rate);

/**
 * @brief Shuts down the ZynAddSubFX engine.
 */
EMSCRIPTEN_KEEPALIVE void zyn_shutdown();

/**
 * @brief Processes audio samples.
 * @param output_buffer Pointer to the output buffer.
 * @param num_frames Number of frames to process.
 * @param num_channels Number of audio channels (1 or 2).
 */
EMSCRIPTEN_KEEPALIVE void zyn_process(float* output_buffer, int num_frames, int num_channels);

/**
 * @brief Sends a MIDI event to the engine.
 * @param midi_data Packed MIDI data (head, num, value).
 */
EMSCRIPTEN_KEEPALIVE void zyn_midi_event(uint32_t midi_data);

/**
 * @brief Sets a synthesis parameter.
 * @param param_id The parameter ID.
 * @param value The value to set.
 */
EMSCRIPTEN_KEEPALIVE void zyn_set_param(int param_id, float value);

/**
 * @brief Loads a master patch (XMZ).
 * @param xml_data The XML data as a string.
 */
EMSCRIPTEN_KEEPALIVE void zyn_load_master_patch(const char* xml_data);

/**
 * @brief Loads an instrument patch into a part (XIZ).
 * @param part_id The part index (0-15).
 * @param xml_data The XML data as a string.
 */
EMSCRIPTEN_KEEPALIVE void zyn_load_part_patch(int part_id, const char* xml_data);

/**
 * @brief Gets the pointer to the pre-allocated output buffer.
 * @return Pointer to the output buffer in WASM heap.
 */
EMSCRIPTEN_KEEPALIVE float* zyn_get_output_buffer_ptr();

} // extern "C"

#endif // ZYN_WASM_H
