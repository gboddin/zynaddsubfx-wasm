#include "zyn_wasm.h"
#include "globals.h"
#include "Misc/MiddleWare.h"
#include "Misc/Config.h"
#include "Misc/Master.h"
#include "Misc/Part.h"
#include "Misc/XMLwrapper.h"
#include "Params/ADnoteParameters.h"
#include <vector>
#include <cstdio>

// --- Global State ---
static zyn::SYNTH_T* g_synth = nullptr;
static zyn::Config* g_config = nullptr;
static float* g_output_buffer = nullptr;
static float* g_internal_l = nullptr;
static float* g_internal_r = nullptr;
static constexpr int MAX_BUFFER_FRAMES = 4096;

zyn::MiddleWare* middleware = nullptr; 

extern "C" {

void zyn_init(int sample_rate) {
    fprintf(stderr, "zyn_init: starting (rate: %d)\n", sample_rate);
    
    fprintf(stderr, "zyn_init: creating config\n");
    g_config = new zyn::Config();
    
    fprintf(stderr, "zyn_init: config created\n");
    
    g_config->cfg.SampleRate = sample_rate;
    g_config->cfg.SoundBufferSize = 128; 
    g_config->cfg.OscilSize = 1024;
    g_config->cfg.GzipCompression = 0;
    g_config->cfg.Interpolation = 0;
    
    fprintf(stderr, "zyn_init: allocating buffers\n");
    g_output_buffer = new float[MAX_BUFFER_FRAMES * 2];
    g_internal_l = new float[MAX_BUFFER_FRAMES];
    g_internal_r = new float[MAX_BUFFER_FRAMES];

    fprintf(stderr, "zyn_init: creating synth object\n");
    g_synth = new zyn::SYNTH_T();
    g_synth->samplerate = static_cast<unsigned int>(sample_rate);
    g_synth->samplerate_f = static_cast<float>(sample_rate);
    g_synth->halfsamplerate_f = 0.5f * g_synth->samplerate_f;
    g_synth->buffersize = 128;
    g_synth->buffersize_f = 128.0f;
    g_synth->bufferbytes = 128 * sizeof(float);
    
    fprintf(stderr, "zyn_init: creating middleware\n");
    middleware = new zyn::MiddleWare(std::move(*g_synth), g_config, 0);
    
    fprintf(stderr, "zyn_init: middleware created at %p\n", (void*)middleware);

    fprintf(stderr, "zyn_init: spawning master\n");
    zyn::Master *master = middleware->spawnMaster();
    fprintf(stderr, "zyn_init: master spawned at %p\n", (void*)master);
    
    fprintf(stderr, "zyn_init: complete\n");
    fflush(stderr);
}

void zyn_midi_event(uint32_t midi_data) {
    if (!middleware) return;
    zyn::Master *master = middleware->spawnMaster();
    if (!master) return;

    unsigned char status = static_cast<unsigned char>((midi_data >> 24) & 0xFF);
    unsigned char num    = static_cast<unsigned char>((midi_data >> 16) & 0xFF);
    unsigned char value  = static_cast<unsigned char>((midi_data >> 8) & 0xFF);

    int chan = status & 0x0F;
    int type = status & 0xF0;

    if (type == 0x90 && value > 0) {
        master->noteOn(chan, num, value);
    } else if (type == 0x80 || (type == 0x90 && value == 0)) {
        master->noteOff(chan, num);
    } else if (type == 0xB0) {
        master->setController(chan, num, value);
    }
}

void zyn_set_param(int param_id, float value) {
    if (!middleware) return;
    zyn::Master *master = middleware->spawnMaster();
    if (master) {
        if (param_id >= 0 && param_id < 16) {
            master->automate.setSlot(param_id, value);
        }
    }
}

void zyn_load_part_patch(int part_id, const char* xml_data) {
    fprintf(stderr, "zyn_load_part_patch: part=%d, data_ptr=%p\n", part_id, (void*)xml_data);
    if (!middleware || part_id < 0 || part_id >= 16) {
        fprintf(stderr, "zyn_load_part_patch: invalid middleware or part_id\n");
        return;
    }
    zyn::Master *master = middleware->spawnMaster();
    if (master && master->part[part_id]) {
        fprintf(stderr, "zyn_load_part_patch: applying to part %d\n", part_id);
        zyn::XMLwrapper xml;
        if(xml.putXMLdata(xml_data)) {
            fprintf(stderr, "zyn_load_part_patch: XML parsed successfully\n");
            // master->ShutUp(); // Removing this, might be causing issues with PADsynth multithreading/locks
            if(xml.enterbranch("INSTRUMENT")) {
                fprintf(stderr, "zyn_load_part_patch: entered INSTRUMENT branch\n");
                
                // Note: We don't call ShutUp() or clear the notes here
                // Zyn's getfromXMLinstrument will update parameters, which might
                // cause some discontinuity if the synthesis engine changes significantly,
                // but it shouldn't "hard cut" unless we tell it to.
                
                master->part[part_id]->Penabled = 1;
                master->part[part_id]->getfromXMLinstrument(xml);
                xml.exitbranch();
                
                // Apply parameters without aborting
                master->part[part_id]->applyparameters([](){ return false; });
                
                // Do NOT call initialize_rt() here if notes are playing!
                // initialize_rt() clears the note pool and buffers, which causes the "hard cut".
                // Instead of checking 'silent' (which is private), we just don't call it.
                // applyparameters already handles most state updates safely.
                
                fprintf(stderr, "zyn_load_part_patch: part updated\n");
            } else {
                fprintf(stderr, "zyn_load_part_patch: FAILED to enter INSTRUMENT branch\n");
            }
        } else {
            fprintf(stderr, "zyn_load_part_patch: FAILED to parse XML\n");
        }
    } else {
        fprintf(stderr, "zyn_load_part_patch: master or part not found\n");
    }
}

void zyn_load_master_patch(const char* xml_data) {
    if (!middleware) return;
    zyn::Master *master = middleware->spawnMaster();
    if (master) {
        master->putalldata(xml_data);
        master->applyparameters();
        master->initialize_rt();
    }
}

float* zyn_get_output_buffer_ptr() {
    return g_output_buffer;
}

float* zyn_get_part_output_l_ptr(int part_id) {
    if (!middleware || part_id < 0 || part_id >= 16) return nullptr;
    zyn::Master *master = middleware->spawnMaster();
    if (!master || !master->part[part_id]) return nullptr;
    return master->part[part_id]->partoutl;
}

float* zyn_get_part_output_r_ptr(int part_id) {
    if (!middleware || part_id < 0 || part_id >= 16) return nullptr;
    zyn::Master *master = middleware->spawnMaster();
    if (!master || !master->part[part_id]) return nullptr;
    return master->part[part_id]->partoutr;
}

void zyn_process(float* output_buffer, int num_frames, int num_channels) {
    if (!middleware) return;
    zyn::Master *master = middleware->spawnMaster();
    if (!master) return;

    // Zyn processes in fixed-size blocks (128 frames by default)
    // AudioWorklet is also 128 frames.
    master->AudioOut(g_internal_l, g_internal_r);

    int frames_to_copy = (num_frames < MAX_BUFFER_FRAMES) ? num_frames : MAX_BUFFER_FRAMES;

    if (num_channels == 2) {
        for (int i = 0; i < frames_to_copy; ++i) {
            output_buffer[i * 2]     = g_internal_l[i];
            output_buffer[i * 2 + 1] = g_internal_r[i];
        }
    } else {
        for (int i = 0; i < frames_to_copy; ++i) {
            output_buffer[i] = g_internal_l[i];
        }
    }
}

void zyn_shutdown() {
    if (middleware) {
        delete middleware;
        middleware = nullptr;
    }
    delete g_synth;
    delete g_config;
    delete[] g_output_buffer;
    delete[] g_internal_l;
    delete[] g_internal_r;
}

} // extern "C"




