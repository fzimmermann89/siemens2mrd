cmake_minimum_required(VERSION 3.21)

project(ismrmrd_wasm LANGUAGES C CXX)

if (NOT EMSCRIPTEN)
  message(FATAL_ERROR "ismrmrd_wasm is intended to be built with Emscripten")
endif ()

include(FetchContent)

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(ISMRMRD_UPSTREAM_DIR "${CMAKE_CURRENT_LIST_DIR}/../ismrmrd")
set(ISMRMRD_GENERATED_INCLUDE_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated/include")
file(MAKE_DIRECTORY "${ISMRMRD_GENERATED_INCLUDE_DIR}/ismrmrd")

set(ISMRMRD_VERSION_MAJOR 1)
set(ISMRMRD_VERSION_MINOR 15)
set(ISMRMRD_VERSION_PATCH 0)
set(ISMRMRD_GIT_SHA1 "submodule")
set(ISMRMRD_DATASET_SUPPORT true)

configure_file(
  "${ISMRMRD_UPSTREAM_DIR}/include/version.in"
  "${ISMRMRD_GENERATED_INCLUDE_DIR}/ismrmrd/version.h"
  @ONLY
)

FetchContent_Declare(
  pugixml_src
  GIT_REPOSITORY https://github.com/zeux/pugixml.git
  GIT_TAG v1.15
)
FetchContent_MakeAvailable(pugixml_src)

add_library(ismrmrd_pugixml STATIC "${pugixml_src_SOURCE_DIR}/src/pugixml.cpp")
target_include_directories(ismrmrd_pugixml PUBLIC "${pugixml_src_SOURCE_DIR}/src")

FetchContent_Declare(
  libhdf5_wasm
  URL https://github.com/usnistgov/libhdf5-wasm/releases/download/v0.6.0_4.0.23/HDF5-1.14.6-Emscripten.tar.gz
  URL_HASH SHA256=d11878bbb9242a7ddc0da85459e9cacb88b7755c9c4991d1f78b01365d3570e4
)
FetchContent_MakeAvailable(libhdf5_wasm)

set(HDF5_DIR "${libhdf5_wasm_SOURCE_DIR}/cmake")
find_package(HDF5 CONFIG REQUIRED)

add_library(
  ismrmrd STATIC
  "${ISMRMRD_UPSTREAM_DIR}/libsrc/ismrmrd.c"
  "${ISMRMRD_UPSTREAM_DIR}/libsrc/ismrmrd.cpp"
  "${ISMRMRD_UPSTREAM_DIR}/libsrc/xml.cpp"
  "${ISMRMRD_UPSTREAM_DIR}/libsrc/meta.cpp"
  "${ISMRMRD_UPSTREAM_DIR}/libsrc/serialization.cpp"
  "${ISMRMRD_UPSTREAM_DIR}/libsrc/waveform.cpp"
  "${ISMRMRD_UPSTREAM_DIR}/libsrc/waveform.c"
  "${ISMRMRD_UPSTREAM_DIR}/libsrc/dataset.c"
  "${ISMRMRD_UPSTREAM_DIR}/libsrc/dataset.cpp"
)

target_include_directories(
  ismrmrd
  PUBLIC
    "${ISMRMRD_UPSTREAM_DIR}/include"
    "${ISMRMRD_GENERATED_INCLUDE_DIR}"
    "${libhdf5_wasm_SOURCE_DIR}/include"
)

target_link_libraries(ismrmrd PRIVATE hdf5::hdf5-static ismrmrd_pugixml)

add_executable(ismrmrd_wasm_writer src/ismrmrd_wasm_writer.c)
target_include_directories(
  ismrmrd_wasm_writer
  PRIVATE
    "${CMAKE_CURRENT_LIST_DIR}/include"
    "${ISMRMRD_UPSTREAM_DIR}/include"
    "${ISMRMRD_GENERATED_INCLUDE_DIR}"
    "${libhdf5_wasm_SOURCE_DIR}/include"
)
target_link_libraries(ismrmrd_wasm_writer PRIVATE ismrmrd)

set_target_properties(
  ismrmrd_wasm_writer
  PROPERTIES
    SUFFIX ".js"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}/build"
)

target_link_options(
  ismrmrd_wasm_writer
  PRIVATE
    "SHELL:--no-entry"
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_ES6=1"
    "SHELL:-s EXPORT_NAME=ISMRMRDWriterModule"
    "SHELL:-s ENVIRONMENT=web,worker,node"
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"
    "SHELL:-s FORCE_FILESYSTEM=1"
    "SHELL:-s EXPORTED_RUNTIME_METHODS=['FS','HEAPU8','UTF8ToString','stringToUTF8']"
    "SHELL:-s EXPORTED_FUNCTIONS=['_malloc','_free','_ismrmrdshim_create_dataset','_ismrmrdshim_open_dataset','_ismrmrdshim_close_dataset','_ismrmrdshim_destroy_dataset','_ismrmrdshim_flush_dataset','_ismrmrdshim_write_header','_ismrmrdshim_read_header','_ismrmrdshim_get_number_of_acquisitions','_ismrmrdshim_get_number_of_waveforms','_ismrmrdshim_append_acquisition','_ismrmrdshim_read_acquisition','_ismrmrdshim_append_waveform','_ismrmrdshim_copy_dataset_with_header','_ismrmrdshim_copy_dataset_with_meta','_ismrmrdshim_get_last_error']"
)
