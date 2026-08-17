# THE UNDERWORLD — C++ host-path build (task C16).
# Builds the translator CLI and the test suite. Links NO trilogy code (LAW 0). The trilogy's
# mandatory flag travels here too (§4 LAW 1): -ffp-contract=off, so any arithmetic that later
# meets a trilogy header is already generated the way the parity gates expect.
cmake_minimum_required(VERSION 3.15)
project(underworld_cpp CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_compile_options(-ffp-contract=off -Wall -Wextra)

add_executable(uw_translate main.cpp)   # settings (flags) -> underworld.chain JSON
add_executable(uw_test test.cpp)        # host-path unit tests

enable_testing()
add_test(NAME uw_test COMMAND uw_test)
