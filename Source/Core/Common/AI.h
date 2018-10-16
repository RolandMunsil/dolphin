#pragma once

#include <random>
#include <unordered_map>

#include "Core/PowerPC/MMU.h"

#include "InputCommon/GCPadStatus.h"

#include "QState.h"

struct ChunkCoordinates
{
  s16 x, y, z;

  bool operator==(const ChunkCoordinates& other) const
  {
    return x == other.x && y == other.y && z == other.z;
  }
};

struct ChunkCoordinatesHasher
{
  std::size_t operator()(const ChunkCoordinates& key) const
  {
    size_t hash = (u32)key.x | ((u32)key.y << 16);
    hash ^= (u32)key.z << 8;
    return hash;
  }
};

struct PlayerInfoRetriever
{
  bool UpdateInfo()
  {
    vehicle_info_ptr = PowerPC::HostRead_U32(0x803e2218);
    if (vehicle_info_ptr == 0)
    {
      return false;
    }
    else
    {
      track_relationship_info_ptr = PowerPC::HostRead_U32(vehicle_info_ptr - 0x20);
      return true;
    }
  }

  float PlayerVehicleX() { return PowerPC::HostRead_F32(vehicle_info_ptr + 0x7C); }
  float PlayerVehicleY() { return PowerPC::HostRead_F32(vehicle_info_ptr + 0x7C + 4); }
  float PlayerVehicleZ() { return PowerPC::HostRead_F32(vehicle_info_ptr + 0x7C + 8); }

  float PlayerSpeed() { return PowerPC::HostRead_F32(vehicle_info_ptr + 0x17C); }

  u32 CurrentFrame() { return PowerPC::HostRead_U32(vehicle_info_ptr + 0x47C); }
  u32 CrashToRestoreFrameCount() { return PowerPC::HostRead_U32(vehicle_info_ptr + 0x194); }
  u16 DuringRestoreFrameCount() { return PowerPC::HostRead_U16(vehicle_info_ptr + 0x214); }

  bool GoingTheWrongWay() { return PowerPC::HostRead_U8(track_relationship_info_ptr + 0x66F); }

  u8 RestoreCountMod256() { return PowerPC::HostRead_U8(vehicle_info_ptr + 0x4C2); }

  u32 CurrentLapNumber() { return PowerPC::HostRead_U32(track_relationship_info_ptr + 0x678); }

  u8 PreviousLapTimeMins() { return PowerPC::HostRead_U8(track_relationship_info_ptr + 0x6CC + 0x8); }
  u8 PreviousLapTimeSecs() { return PowerPC::HostRead_U8(track_relationship_info_ptr + 0x6CC + 0x9); }
  u16 PreviousLapTimeMillis() { return PowerPC::HostRead_U16(track_relationship_info_ptr + 0x6CC + 0xA); }

private:
  u32 vehicle_info_ptr;
  u32 track_relationship_info_ptr;
};

class AI
{
  const size_t INITIAL_MAP_BUCKET_COUNT = 10000;
  const u32 SECONDS_BETWEEN_STATE_SAVES = 60;

  const float CHUNK_SIZE_METERS = 16;

  // Exploration rate controls how often it will just pick a random value (instead of picking the
  // best value)
  // exploration rate decreases linearly over the course of 4 hours
  const float EXPLORATION_RATE_TIME_TO_ZERO_IN_HOURS = 4;
  float CalculateExplorationRate()
  {
    float timeToZeroInFrames = 60 * 60 * 60 * EXPLORATION_RATE_TIME_TO_ZERO_IN_HOURS;
    return std::max(0.0f, 1 - (learning_occured_frame_count / timeToZeroInFrames));
  };

  // Learning rate controls how quickly the network replaces the old value with the new
  const float LEARNING_RATE = 0.6f;

  // Discount rate controls how much the network cares about future rewards
  const float DISCOUNT_RATE = 0.5f;

public:
  AI();
  ~AI();

  bool IsEnabled(GCPadStatus userInput);

  GCPadStatus GetNextInput(const u32 pad_index);

private:
  ChunkCoordinates CalculateUserChunk();
  QState* GetCurrentQState(ChunkCoordinates chunk);
  float CalculateReward();
  Action ChooseAction(QState* state, bool* action_chosen_randomly);
  GCPadStatus GenerateInputsFromAction(Action action);

  void SaveStateToLog();

  std::default_random_engine generator;
  std::uniform_real_distribution<float> real_distribution;
  std::uniform_int_distribution<u32> action_index_distribution;

  std::unordered_map<ChunkCoordinates, ChunkStates*, ChunkCoordinatesHasher> chunk_to_states_map;

  PlayerInfoRetriever player_info_retriever;

  bool did_q_learning_last_frame;
  QState* previous_state;
  Action previous_action;

  bool enabled;
  bool toggle_button_pressed_previous;

  u32 frame_at_last_input_request;
  GCPadStatus cached_inputs;

  u32 learning_occured_frame_count;
  u32 skip_learning_because_cant_access_info_frame_count;
  u32 skip_learning_because_crashing_frame_count;
  u32 generate_inputs_but_dont_learn_frame_count;

  u32 restore_count;


  bool debug_info_enabled;
  bool debug_info_enabled_button_pressed_previous;

  u8 prevRestoreCountMod256;
  u32 prevLapNumber;
  std::vector<u32> lap_times_millis;
};
