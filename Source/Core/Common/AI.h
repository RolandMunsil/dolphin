#pragma once

#include <random>
#include <unordered_map>

#include "InputCommon/GCPadStatus.h"

#include "Actions.h"
#include "Chunk.h"
#include "PlayerInfoRetriever.h"

class AI
{
  const size_t INITIAL_MAP_BUCKET_COUNT = 10000;
  const u32 SECONDS_BETWEEN_STATE_SAVES = 60 * 10;

  const bool REWARD_USING_ACCELERATION = false;
  //NOTE: this variable doesn't actually do anything (if you want to use Advantage Updating checkout the corresponding branch)
  //It's mainly just here as a reminder that the mode is one of the parameters that can be changed
  const bool MODE_IS_Q_LEARNING = true;

  const float CHUNK_SIZE_METERS = 30;

  // Exploration rate controls how often it will just pick a random value (instead of picking the best value)
  // exploration rate decreases linearly over the course of N hours
  const float EXPLORATION_RATE_TIME_TO_ZERO_IN_LEARNING_HOURS = 5;
  float CalculateExplorationRate()
  {
    float timeToZeroInFrames = 60 * 60 * 60 * EXPLORATION_RATE_TIME_TO_ZERO_IN_LEARNING_HOURS;
    return std::max(0.0f, 1 - (learning_occured_frame_count / timeToZeroInFrames));
  };

  // Learning rate controls how quickly the network replaces the old value with the new
  const float LEARNING_RATE = 0.6f;

  // Discount rate controls how much the network cares about future rewards
  const float DISCOUNT_RATE = 0.8f;

public:
  AI();
  ~AI();

  void UpdateBasedOnUserInput(GCPadStatus userInput);
  bool IsEnabled() { return enabled; }

  GCPadStatus GetNextInput(const u32 pad_index);

private:
  bool CheckForCorrectControllerIndex(const u32 pad_index);
  bool CheckThatMemoryCanBeAccessed();
  bool CheckThatRaceHasStarted(const u32 thisFrame);
  bool CheckThatThisIsANewFrame(const u32 thisFrame);
  void CheckForMissedFramesAndHandle(const u32 thisFrame);
  bool CheckThatAIIsAlive();
  void UpdateLapsAndRestoreCount();

  ChunkCoordinates CalculateUserChunk();
  ScoredActions* GetCurrentScoredActions(ChunkCoordinates chunkCoords);
  float CalculateReward();
  Action ChooseAction(ScoredActions* state, bool* action_chosen_randomly);

  void SaveStateToLog();
  void WriteAIParametersToLog();

  std::default_random_engine generator;
  std::uniform_real_distribution<float> real_distribution;
  std::uniform_int_distribution<u32> action_index_distribution;

  std::unordered_map<ChunkCoordinates, Chunk*, ChunkCoordinatesHasher> chunk_coord_to_chunk_map;

  PlayerInfoRetriever player_info_retriever;

  bool did_q_learning_last_frame;
  ScoredActions* previous_scored_actions;
  bool previous_going_wrong_way;
  ChunkCoordinates previous_chunk_coords;
  Action previous_action;

  float prevPlayerSpeed;

  bool enabled;
  bool toggle_button_pressed_previous;

  u32 frame_at_last_input_request;
  GCPadStatus cached_inputs;

  u32 learning_occured_frame_count;
  u32 skip_learning_because_cant_access_info_frames_lost;
  u32 skip_learning_because_crashing_frame_count;
  u32 generate_inputs_but_dont_learn_frame_count;

  u32 restore_count;
  bool betweenDeathAndRestore;

  bool addressTranslationDisabledLastInputRequest;
  u32 frameCountBeforeAddressTranslationDisabled;

  bool debug_info_enabled;
  bool debug_info_enabled_button_pressed_previous;

  u8 prevRestoreCountMod256;
  u32 prevLapNumber;
  std::vector<u32> lap_times_millis;
};
