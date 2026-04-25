cmake_minimum_required(VERSION 3.10)
project(zyn_wasm_entry)

set(CMAKE_CXX_STANDARD 20)

# These should be passed from the parent Makefile or set to defaults
if(NOT ZYN_SRC_DIR)
    set(ZYN_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../zynaddsubfx/src")
endif()
if(NOT ZYN_BUILD_DIR)
    set(ZYN_BUILD_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../build-zyn")
endif()
if(NOT DEPS_INSTALL_DIR)
    set(DEPS_INSTALL_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../deps")
endif()

# Emscripten specific flags
# Matches what was in the original but uses variables and supports modularization
set(EMSCRIPTEN_FLAGS "--profiling -s WASM=1 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME='createZynModule' -s ENVIRONMENT='web,worker,node,shell' -s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','wasmMemory','lengthBytesUTF8','stringToUTF8','FS'] -s EXPORTED_FUNCTIONS=['_zyn_init','_zyn_shutdown','_zyn_process','_zyn_midi_event','_zyn_get_output_buffer_ptr','_zyn_set_param','_zyn_load_master_patch','_zyn_load_part_patch','_malloc','_free'] -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=268435456 -s MALLOC=emmalloc -s STACK_SIZE=4194304 --no-entry -s ERROR_ON_UNDEFINED_SYMBOLS=0 --embed-file ${CMAKE_CURRENT_SOURCE_DIR}/../patches@/patches -s FORCE_FILESYSTEM=1")

# Removed: --embed-file /opt/zf2strudel/patches@/patches - we will handle patches/assets later

set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${EMSCRIPTEN_FLAGS}")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${EMSCRIPTEN_FLAGS}")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} ${EMSCRIPTEN_FLAGS}")

# Include directories
include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${ZYN_SRC_DIR}
    ${ZYN_BUILD_DIR}/src
    ${ZYN_SRC_DIR}/Nio
    ${ZYN_SRC_DIR}/Params
    ${ZYN_SRC_DIR}/Effects
    ${ZYN_SRC_DIR}/Misc
    ${ZYN_SRC_DIR}/Synth
    ${ZYN_SRC_DIR}/DSP
    ${ZYN_SRC_DIR}/Containers
    ${ZYN_SRC_DIR}/../rtosc/include
    ${DEPS_INSTALL_DIR}/include
    ${DEPS_INSTALL_DIR}/include/libmxml4
)

# Static libraries to link
set(ZYN_CORE_LIB "${ZYN_BUILD_DIR}/src/libzynaddsubfx_core.a")
set(ZYN_NIO_LIB "${ZYN_BUILD_DIR}/src/Nio/libzynaddsubfx_nio.a")
set(ZYN_GUI_LIB "${ZYN_BUILD_DIR}/src/libzynaddsubfx_gui_bridge.a")
set(RTOSC_LIB "${ZYN_BUILD_DIR}/rtosc/librtosc.a")
set(RTOSC_CPP_LIB "${ZYN_BUILD_DIR}/rtosc/librtosc-cpp.a")

set(LIBLO_LIB "${DEPS_INSTALL_DIR}/lib/liblo.a")
set(FFTW3F_LIB "${DEPS_INSTALL_DIR}/lib/libfftw3f.a")
set(MXML_LIB "${DEPS_INSTALL_DIR}/lib/libmxml4.a")
set(ZLIB_LIB "${DEPS_INSTALL_DIR}/lib/libz.a")

add_executable(zyn_wasm_api zyn_wasm_api.cpp)

target_link_libraries(zyn_wasm_api
    ${ZYN_CORE_LIB}
    ${ZYN_NIO_LIB}
    ${ZYN_GUI_LIB}
    ${RTOSC_CPP_LIB}
    ${RTOSC_LIB}
    ${LIBLO_LIB}
    ${FFTW3F_LIB}
    ${MXML_LIB}
    ${ZLIB_LIB}
)

# Set output filename to zyn_wasm.js and zyn_wasm.wasm
set_target_properties(zyn_wasm_api PROPERTIES OUTPUT_NAME "zyn_wasm")
