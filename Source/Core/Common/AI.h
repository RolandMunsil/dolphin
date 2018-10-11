#pragma once

#include <random>
#include <unordered_map>

#include "InputCommon/GCPadStatus.h"

const size_t INITIAL_MAP_BUCKET_COUNT = 100000;
const float INITIAL_ACTION_SCORE = 0;

const float CHUNK_SIZE_METERS = 8;

// TODO: have these change over time?
// Exploration rate controls how often it will just pick a random value (instead of picking the best
// value)
const float EXPLORATION_RATE = 0.1f;

// Learning rate controls how quickly the network replaces the old value with the new
const float LEARNING_RATE = 0.7f;

// Discount rate controls how much the network cares about future rewards
const float DISCOUNT_RATE = 0.9f;

enum class Action
{
  SHARP_TURN_LEFT,
  SOFT_TURN_LEFT,
  FORWARD,
  SOFT_TURN_RIGHT,
  SHARP_TURN_RIGHT,

  BOOST_AND_SHARP_TURN_LEFT,
  BOOST_AND_SOFT_TURN_LEFT,
  BOOST_AND_FORWARD,
  BOOST_AND_SOFT_TURN_RIGHT,
  BOOST_AND_SHARP_TURN_RIGHT,

  DRIFT_AND_SHARP_TURN_LEFT,
  DRIFT_AND_SHARP_TURN_RIGHT,

  // Used so we know the number of actions
  ACTIONS_COUNT
};

const std::unordered_map<Action, std::string> ACTION_NAMES = {
    {Action::SHARP_TURN_LEFT, "Sharp turn left"},
    {Action::SOFT_TURN_LEFT, "Soft turn left"},
    {Action::FORWARD, "Forward"},
    {Action::SOFT_TURN_RIGHT, "Soft turn right"},
    {Action::SHARP_TURN_RIGHT, "Sharp turn right"},

    {Action::BOOST_AND_SHARP_TURN_LEFT, "Boost+Sharp turn left"},
    {Action::BOOST_AND_SOFT_TURN_LEFT, "Boost+Soft turn left"},
    {Action::BOOST_AND_FORWARD, "Boost+Forward"},
    {Action::BOOST_AND_SOFT_TURN_RIGHT, "Boost+Soft turn right"},
    {Action::BOOST_AND_SHARP_TURN_RIGHT, "Boost+Sharp turn right"},

    {Action::DRIFT_AND_SHARP_TURN_LEFT, "Drift left"},
    {Action::DRIFT_AND_SHARP_TURN_RIGHT, "Drift right"}};

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

class QState
{
private:
  float action_scores[(u32)Action::ACTIONS_COUNT];

  void GetBestActionAndScore(Action* best_action, float* best_score)
  {
    *best_score = -FLT_MAX;
    *best_action = (Action)-1;

    for (u32 i = 0; i < (u32)Action::ACTIONS_COUNT; i++)
    {
      if (action_scores[i] > *best_score)
      {
        *best_score = action_scores[i];
        *best_action = (Action)i;
      }
    }
  }

public:
  QState() { std::fill_n(action_scores, (u32)Action::ACTIONS_COUNT, INITIAL_ACTION_SCORE); }

  float ScoreForAction(Action action) { return action_scores[(u32)action]; }

  void SetActionScore(Action action, float score) { action_scores[(u32)action] = score; }

  Action BestAction()
  {
    float best_score;
    Action best_action;
    GetBestActionAndScore(&best_action, &best_score);
    return best_action;
  }

  float BestScore()
  {
    float best_score;
    Action best_action;
    GetBestActionAndScore(&best_action, &best_score);
    return best_score;
  }
};

class AI
{
public:
  AI();
  ~AI();

  bool IsEnabled(GCPadStatus userInput);

  GCPadStatus GetNextInput(const u32 pad_index);

private:
  ChunkCoordinates CalculateUserChunk(u32 player_state_ptr);
  QState* GetStateForChunk(ChunkCoordinates chunk);
  float CalculateReward(u32 player_state_ptr);
  Action ChooseAction(QState* state, bool* action_chosen_randomly);
  GCPadStatus GenerateInputsFromAction(Action action);

  std::default_random_engine generator;
  std::uniform_real_distribution<float> real_distribution;
  std::uniform_int_distribution<u32> action_index_distribution;

  std::unordered_map<ChunkCoordinates, QState*, ChunkCoordinatesHasher> chunk_to_actions_map;

  bool did_q_learning_last_frame;
  QState* previous_state;
  Action previous_action;

  bool enabled;
  bool toggle_button_pressed_previous;
};
