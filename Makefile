ROOT_DIR := $(shell pwd)
ZYN_SRC := $(ROOT_DIR)/zynaddsubfx
ZYN_BUILD := $(ROOT_DIR)/build-zyn
DEPS_DIR := $(ROOT_DIR)/deps
DEPS_SRC_DIR := $(DEPS_DIR)/src
ENTRY_SRC := $(ROOT_DIR)/wasm_entry
ENTRY_BUILD := $(ENTRY_SRC)/build

# Tools
EMCMAKE := emcmake cmake
EMMAKE := emmake

# Dependency URLs
FFTW_URL := https://fftw.org/fftw-3.3.11.tar.gz
LIBLO_URL := https://github.com/radarsat1/liblo/releases/download/0.34/liblo-0.34.tar.gz
MXML_URL := https://github.com/michaelrsweet/mxml/releases/download/v4.0.4/mxml-4.0.4.tar.gz
ZLIB_URL := https://www.zlib.net/zlib-1.3.2.tar.gz
LIBSNDFILE_URL := https://github.com/libsndfile/libsndfile/releases/download/1.2.2/libsndfile-1.2.2.tar.xz

# Export pkg-config variables for the build
export PKG_CONFIG_PATH := $(DEPS_DIR)/lib/pkgconfig
export PKG_CONFIG_LIBDIR := $(DEPS_DIR)/lib/pkgconfig
export PKG_CONFIG_SYSROOT_DIR := /

# Emscripten common flags
EM_FLAGS := 
EM_LDFLAGS := -s ALLOW_MEMORY_GROWTH=1

.PHONY: all deps core entry clean distclean patch submodule reset-submodule check-tools zlib fftw liblo mxml libsndfile patches

all: check-tools deps reset-submodule patches patch core entry

check-tools:
	@command -v python3 >/dev/null 2>&1 || { echo >&2 "python3 not found. Install Python 3."; exit 1; }
	@command -v cmake >/dev/null 2>&1 || { echo >&2 "cmake not found."; exit 1; }
	@command -v node >/dev/null 2>&1 || { echo >&2 "nodejs not found. Install Nodejs."; exit 1; }
	@command -v emcc >/dev/null 2>&1 || { echo >&2 "emcc not found. Install Emscripten."; exit 1; }
	@command -v wget >/dev/null 2>&1 || { echo >&2 "wget not found."; exit 1; }
	@mkdir -p $(DEPS_SRC_DIR) $(DEPS_DIR)/lib $(DEPS_DIR)/include

deps: zlib fftw liblo mxml libsndfile

zlib: $(DEPS_DIR)/lib/libz.a
$(DEPS_DIR)/lib/libz.a:
	@echo "Building zlib..."
	@cd $(DEPS_SRC_DIR) && wget -nc $(ZLIB_URL)
	@cd $(DEPS_SRC_DIR) && tar xzf zlib-1.3.2.tar.gz
	@cd $(DEPS_SRC_DIR)/zlib-1.3.2 && emconfigure ./configure --host=wasm32-unknown-emscripten --prefix=$(DEPS_DIR) --static
	@cd $(DEPS_SRC_DIR)/zlib-1.3.2 && $(EMMAKE) make -j $(shell nproc) install

fftw: $(DEPS_DIR)/lib/libfftw3f.a
$(DEPS_DIR)/lib/libfftw3f.a:
	@echo "Building FFTW..."
	@cd $(DEPS_SRC_DIR) && wget -nc $(FFTW_URL)
	@cd $(DEPS_SRC_DIR) && tar xzf fftw-3.3.11.tar.gz
	@cd $(DEPS_SRC_DIR)/fftw-3.3.11 && emconfigure ./configure --host=wasm32-unknown-emscripten --prefix=$(DEPS_DIR) --enable-float --disable-fortran --disable-threads --enable-static
	@cd $(DEPS_SRC_DIR)/fftw-3.3.11 && $(EMMAKE) make -j $(shell nproc) install

liblo: $(DEPS_DIR)/lib/liblo.a
$(DEPS_DIR)/lib/liblo.a:
	@echo "Building liblo..."
	@cd $(DEPS_SRC_DIR) && wget -nc $(LIBLO_URL)
	@cd $(DEPS_SRC_DIR) && tar xzf liblo-0.34.tar.gz
	@cd $(DEPS_SRC_DIR)/liblo-0.34 && emconfigure ./configure --host=wasm32-unknown-emscripten --prefix=$(DEPS_DIR) --enable-static --disable-shared --disable-doc
	@cd $(DEPS_SRC_DIR)/liblo-0.34 && $(EMMAKE) make -j $(shell nproc) install

mxml: $(DEPS_DIR)/lib/libmxml4.a
$(DEPS_DIR)/lib/libmxml4.a:
	@echo "Building mxml..."
	@cd $(DEPS_SRC_DIR) && wget -nc $(MXML_URL)
	@cd $(DEPS_SRC_DIR) && tar xzf mxml-4.0.4.tar.gz
	@cd $(DEPS_SRC_DIR)/mxml-4.0.4 && emconfigure ./configure --host=wasm32-unknown-emscripten --prefix=$(DEPS_DIR) --enable-static --disable-shared
	@cd $(DEPS_SRC_DIR)/mxml-4.0.4 && $(EMMAKE) make -j $(shell nproc) install

libsndfile: $(DEPS_DIR)/lib/libsndfile.a
$(DEPS_DIR)/lib/libsndfile.a:
	@echo "Building libsndfile..."
	@cd $(DEPS_SRC_DIR) && wget -nc $(LIBSNDFILE_URL)
	@cd $(DEPS_SRC_DIR) && tar xJf libsndfile-1.2.2.tar.xz
	@cd $(DEPS_SRC_DIR)/libsndfile-1.2.2 && emconfigure ./configure --host=wasm32-unknown-emscripten --prefix=$(DEPS_DIR) --enable-static --disable-shared --disable-external-libs --disable-sqlite
	@cd $(DEPS_SRC_DIR)/libsndfile-1.2.2 && $(EMMAKE) make -j $(shell nproc) install


# --- Patch Preparation (Internal Banks) ---
patches: submodule
	@echo "Preparing internal patch banks..."
	@./scripts/prepare_patches.sh
	@echo "Generating patch list JSON..."
	@python3 scripts/generate_patch_list.py

# --- Submodules & Patching ---
submodule:
	@echo "Updating submodules..."
	@git submodule update --init --recursive

reset-submodule:
	@echo "Resetting zynaddsubfx submodule to clean state..."
	@rm -rf zynaddsubfx
	@git submodule update --init --recursive

patch:
	@cd $(ZYN_SRC) && patch -p1 < ../zyn-wasm-patch.patch


# --- ZynAddSubFX Build ---
core: patch
	@echo "Configuring ZynAddSubFX core..."
	@mkdir -p $(ZYN_BUILD)
	@cd $(ZYN_BUILD) && $(EMCMAKE) $(ZYN_SRC) \
		-DGuiModule=off \
		-DZYN_SYSTEM_RTOSC=OFF \
		-DCompileTests=OFF \
		-DOssEnable=OFF \
                -DAlsaEnable=OFF \
                -DJackEnable=OFF \
		-DPluginEnable=OFF \
		-DDssiEnable=OFF \
		-DLashEnable=OFF \
		-DCompileTests=OFF \
		-DBuildForAMD_X86_64=OFF \
		-DBuildForCore2_X86_64=OFF \
		-DDemoMode=OFF \
		-DDBUILD_RTOSC_EXAMPLES=OFF \
		-DCMAKE_BUILD_TYPE=Release \
		-DCMAKE_PREFIX_PATH=$(DEPS_DIR) \
                -DZLIB_INCLUDE_DIR=$(DEPS_DIR)/include \
                -DZLIB_LIBRARY=$(DEPS_DIR)/lib/libz.a \
		-DCMAKE_CXX_FLAGS="$(EM_FLAGS)" \
		-DCMAKE_C_FLAGS="$(EM_FLAGS)" \
		-DCMAKE_EXE_LINKER_FLAGS="$(EM_LDFLAGS)" -L
	@echo "Building ZynAddSubFX core..."
	@cd $(ZYN_BUILD) && $(EMMAKE) make -j$(shell nproc) zynaddsubfx_core zynaddsubfx_nio zynaddsubfx_gui_bridge

# --- Entry Point Build ---
entry: core patches
	@echo "Building WASM entry point..."
	@mkdir -p $(ENTRY_BUILD)
	@cd $(ENTRY_BUILD) && $(EMCMAKE) .. \
		-DZYN_SRC_DIR=$(ZYN_SRC)/src \
		-DZYN_BUILD_DIR=$(ZYN_BUILD) \
		-DDEPS_INSTALL_DIR=$(DEPS_DIR)
	@cd $(ENTRY_BUILD) && $(EMMAKE) make -j$(shell nproc)
	@cp $(ENTRY_BUILD)/zyn_wasm.js web/
	@cp $(ENTRY_BUILD)/zyn_wasm.wasm web/

# --- Cleanup ---
clean:
	rm -rf $(ZYN_BUILD) $(ENTRY_BUILD)

distclean: clean
	rm -rf $(DEPS_DIR) $(ZYN_SRC)
