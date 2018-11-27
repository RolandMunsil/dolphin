#include "AI.h"

#include <chrono>

#include "StringUtil.h"

#include "Common/Common.h"
#include "Common/CommonTypes.h"
#include "Common/Logging/ConsoleListener.h"
#include "Common/Logging/Log.h"
#include "Common/MsgHandler.h"

#include "Core/PowerPC/PowerPC.h"

float MoveValueTowards(float rate, float oldValue, float newValue)
{
  return (oldValue * (1 - rate)) + (newValue * rate);
}

template <typename... Args>
void AILog(const char* str, Args... args)
{
  std::string formatted = StringFromFormat(str, args...);
  LogListener*& logWindowListener = LogManager::GetInstance()->GetListeners()[LogListener::LOG_WINDOW_LISTENER];
  logWindowListener->Log(LogTypes::LOG_LEVELS::LINFO, formatted.c_str());
}

LogListener* logFileListener = nullptr;
template <typename... Args>
void LogToFileListener(const char* str, Args... args)
{
  if (logFileListener == nullptr)
  {
    logFileListener = LogManager::GetInstance()->GetListeners()[LogListener::FILE_LISTENER];
  }

  std::ostringstream oss;
  oss << str << std::endl;
  logFileListener->Log(LogTypes::LOG_LEVELS::LINFO, StringFromFormat(oss.str().c_str(), args...).c_str());
}

std::string StateToString(AdvantageUpdatingState state)
{
  std::ostringstream as_string;
  as_string << "V[" << std::fixed << std::setprecision(10) << state.expectedOptimalValue << "]";

  for (u32 a = 0; a < (u32)Action::ACTIONS_COUNT; a++)
  {
    as_string << std::fixed << std::setprecision(10) << state.advantages.ScoreForAction((Action)a) << ";";
  }
  return as_string.str();
}

void AI::SaveStateToLog()
{
  LogToFileListener("===================== BEGIN STATE =====================");
  LogToFileListener("___SUMMARY INFO___:");
  LogToFileListener("Frame Ct total learning: %i", learning_occured_frame_count);
  LogToFileListener("Frame Ct lost because can't access info: %i", skip_learning_because_cant_access_info_frames_lost);
  LogToFileListener("Frame Ct skip learning because death: %i", skip_learning_because_crashing_frame_count);
  LogToFileListener("Frame Ct gen inputs but don't learn: %i", generate_inputs_but_dont_learn_frame_count);
  LogToFileListener("Frame Ct total: %i", player_info_retriever.TotalFrames());
  LogToFileListener("Restore count: %i", restore_count);
  LogToFileListener("Chunk count: %i", chunk_coord_to_chunk_map.size());
  LogToFileListener("State count: %i", chunk_coord_to_chunk_map.size() * 2);
  LogToFileListener("Current exploration rate: %.10f", CalculateExplorationRate());

  std::ostringstream lap_times_string;
  for (u32 time : lap_times_millis)
  {
    lap_times_string << time << ";";
  }
  LogToFileListener("Lap times (ms): %s", lap_times_string.str().c_str());

  LogToFileListener("___Q TABLE___:");

  for (auto const& [chunk_coord, chunk] : chunk_coord_to_chunk_map)
  {
    std::string right_way_values_string = StateToString(chunk->going_right_way_state);
    std::string wrong_way_values_string = StateToString(chunk->going_wrong_way_state);
    LogToFileListener("(%i;%i;%i)=$R{%s}|W{%s}", chunk_coord.x, chunk_coord.y, chunk_coord.z, right_way_values_string.c_str(),
                      wrong_way_values_string.c_str());
  }
  LogToFileListener("====================== END STATE ======================");
}

void AI::WriteAIParametersToLog()
{
  LogToFileListener("________AI ENABLED________");
  LogToFileListener("Mode: ADVANTAGE)");
  LogToFileListener("Chunk size: %f", CHUNK_SIZE_METERS);
  LogToFileListener("Hours for exploration rate to get to zero: %f", EXPLORATION_RATE_TIME_TO_ZERO_IN_LEARNING_HOURS);
  LogToFileListener("Advantage update rate: %f", ADVANTAGE_UPDATE_RATE);
  LogToFileListener("EOV update rate: %f", EOV_UPDATE_RATE);
  LogToFileListener("Normalization rate: %f", NORMALIZATION_RATE);
  LogToFileListener("Normalizations per frame rate: %f", NORMALIZATIONS_PER_FRAME);
  LogToFileListener("Discount rate: %f", DISCOUNT_RATE);
  LogToFileListener("__END AI ENABLED SECTION__");
}

AI::AI()
{
  enabled = false;
  toggle_button_pressed_previous = false;

  did_q_learning_last_frame = false;

  real_distribution = std::uniform_real_distribution<float>(0.0, 1.0);
  action_index_distribution = std::uniform_int_distribution<u32>(0, (u32)Action::ACTIONS_COUNT - 1);

  chunk_coord_to_chunk_map = std::unordered_map<ChunkCoordinates, Chunk*, ChunkCoordinatesHasher>(INITIAL_MAP_BUCKET_COUNT);

  learning_occured_frame_count = 0;
  skip_learning_because_cant_access_info_frames_lost = 0;
  skip_learning_because_crashing_frame_count = 0;
  generate_inputs_but_dont_learn_frame_count = 0;
  debug_info_enabled = true;

  addressTranslationDisabledLastInputRequest = false;
  frameCountBeforeAddressTranslationDisabled = -1000;

  restore_count = 0;
  prevRestoreCountMod256 = 0;
  prevLapNumber = 0;
  lap_times_millis = std::vector<u32>();
}

void AI::UpdateBasedOnUserInput(GCPadStatus userInput)
{
  if (userInput.button & PAD_BUTTON_X)
  {
    if (!debug_info_enabled_button_pressed_previous)
    {
      // toggle
      debug_info_enabled = !debug_info_enabled;
    }
    debug_info_enabled_button_pressed_previous = true;
  }
  else
  {
    debug_info_enabled_button_pressed_previous = false;
  }

  if (userInput.button & PAD_TRIGGER_Z)
  {
    if (!toggle_button_pressed_previous)
    {
      // toggle
      enabled = !enabled;

      if (enabled)
      {
        AILog("~~~~~~~~~~~~AI ENABLED~~~~~~~~~~~~");
        WriteAIParametersToLog();
      }
      else
      {
        AILog("~~~~~~~~~~~~AI DISABLED~~~~~~~~~~~~");
      }
    }
    toggle_button_pressed_previous = true;
  }
  else
  {
    toggle_button_pressed_previous = false;
  }
}

ChunkCoordinates AI::CalculateUserChunk()
{
  ChunkCoordinates userChunk = {(s16)std::floorf(player_info_retriever.PlayerVehicleX() / CHUNK_SIZE_METERS),
                                (s16)std::floorf(player_info_retriever.PlayerVehicleY() / CHUNK_SIZE_METERS),
                                (s16)std::floorf(player_info_retriever.PlayerVehicleZ() / CHUNK_SIZE_METERS)};

  return userChunk;
}

AdvantageUpdatingState* AI::GetCurrentState(ChunkCoordinates chunkCoordinates)
{
  Chunk*& chunk = chunk_coord_to_chunk_map[chunkCoordinates];
  if (chunk == nullptr)
  {
    chunk = new Chunk;
  }

  if (player_info_retriever.GoingTheWrongWay())
  {
    return &(chunk->going_wrong_way_state);
  }
  else
  {
    return &(chunk->going_right_way_state);
  }
}

float AI::CalculateReward()
{
  return (player_info_retriever.PlayerSpeed()-prevPlayerSpeed) * (player_info_retriever.GoingTheWrongWay() ? -1 : 1);
}

Action AI::ChooseAction(ScoredActions* actions, bool* action_chosen_randomly)
{
  float rand = real_distribution(generator);
  if (rand < CalculateExplorationRate())
  {
    u32 actionIndex = action_index_distribution(generator);
    *action_chosen_randomly = true;
    return (Action)actionIndex;
  }
  else
  {
    *action_chosen_randomly = false;
    return actions->BestAction();
  }
}

bool AI::CheckForCorrectControllerIndex(const u32 pad_index)
{
  if (pad_index != 0)
  {
    if (debug_info_enabled)
    {
      AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      AILog("Ignoring input request because pad index is %i", pad_index);
    }
    return false;
  }
  return true;
}

bool AI::CheckThatMemoryCanBeAccessed()
{
  if (!MSR.DR)
  {
    AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    AILog("Address translation disabled, ignoring input request.");

    if (addressTranslationDisabledLastInputRequest == false)
    {
      addressTranslationDisabledLastInputRequest = true;
      frameCountBeforeAddressTranslationDisabled = frame_at_last_input_request;
    }

    return false;
  }

  if (!player_info_retriever.UpdateInfo())
  {
    PanicAlert("Pointer to player state is null!");
    return false;
  }
  return true;
}
bool AI::CheckThatRaceHasStarted(const u32 thisFrame)
{
  if (thisFrame == 0)
  {
    AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    AILog("Ignoring input request because race hasn't started");
    return false;
  }
  return true;
}
bool AI::CheckThatThisIsANewFrame(const u32 thisFrame)
{
  if (thisFrame == frame_at_last_input_request)
  {
    // AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    // AILog("Duplicate request for frame, returning cached input.");
    return false;
  }
  return true;
}
void AI::CheckForMissedFramesAndHandle(const u32 thisFrame)
{
  if (addressTranslationDisabledLastInputRequest)
  {
    if (thisFrame > frame_at_last_input_request + 1)
    {
      u32 frameDiff = (thisFrame - frameCountBeforeAddressTranslationDisabled) - 1;
      skip_learning_because_cant_access_info_frames_lost += frameDiff;
      AILog("Frames lost: %i", frameDiff);
      did_q_learning_last_frame = false;

      LogToFileListener("> FRAMESLOST %i (ct=%i)", frameDiff, skip_learning_because_cant_access_info_frames_lost);
    }
    else
    {
      AILog("No frames lost %i", thisFrame - frameCountBeforeAddressTranslationDisabled);
    }
    addressTranslationDisabledLastInputRequest = false;
  }

  u32 expectedTotalFrames = 1 + (learning_occured_frame_count + skip_learning_because_crashing_frame_count +
                                 skip_learning_because_cant_access_info_frames_lost + generate_inputs_but_dont_learn_frame_count);
  if (thisFrame != expectedTotalFrames)
  {
    AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    AILog("Frames lost for unknown reason!");

    u32 frameDiff = thisFrame - expectedTotalFrames;
    skip_learning_because_cant_access_info_frames_lost += frameDiff;

    LogToFileListener("> FRAMESLOST unknown %i (ct=%i)", frameDiff, skip_learning_because_cant_access_info_frames_lost);
  }
}
bool AI::CheckThatAIIsAlive()
{
  if (player_info_retriever.CrashToRestoreFrameCount() > 0 || player_info_retriever.DuringRestoreFrameCount() > 0)
  {
    if (debug_info_enabled)
    {
      AILog("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      AILog("Skipping q-learning because car is currently crashing or being restored.");
    }
    did_q_learning_last_frame = false;
    skip_learning_because_crashing_frame_count++;

    LogToFileListener("> SKIP because crashing (ct=%i)", skip_learning_because_crashing_frame_count);

    cached_inputs = {};
    return false;
  }
  return true;
}
void AI::UpdateLapsAndRestoreCount()
{
  if (player_info_retriever.CurrentLapNumber() != prevLapNumber)
  {
    if (player_info_retriever.CurrentLapNumber() != prevLapNumber + 1)
    {
      PanicAlert("Something went wrong during lap number tracking!");
    }

    u32 lapTimeMillis = player_info_retriever.PreviousLapTimeMillis() + player_info_retriever.PreviousLapTimeSecs() * 1000 +
                        player_info_retriever.PreviousLapTimeMins() * 60 * 1000;

    lap_times_millis.push_back(lapTimeMillis);
    if (lap_times_millis[prevLapNumber] != lapTimeMillis)
    {
      PanicAlert("Something went wrong during lap number tracking!");
    }

    LogToFileListener("> LAP %i: %i ms", prevLapNumber, lapTimeMillis);

    prevLapNumber++;
  }

  if (player_info_retriever.RestoreCountMod256() != prevRestoreCountMod256)
  {
    prevRestoreCountMod256 = player_info_retriever.RestoreCountMod256();
    restore_count++;

    LogToFileListener("> RESTORE (ct=%i)", restore_count);

    if (restore_count % 256 != prevRestoreCountMod256)
    {
      PanicAlert("Restore count is not being calculated properly!");
    }
  }
}

GCPadStatus AI::GetNextInput(const u32 pad_index)
{
  std::chrono::time_point calc_start_time = std::chrono::system_clock::now();

  ///
  /// PERFORM CHECKS & UPDATE CERTAIN STATS
  ///
  if (!CheckForCorrectControllerIndex(pad_index) || !CheckThatMemoryCanBeAccessed())
  {
    return {};
  }

  u32 thisFrame = player_info_retriever.TotalFrames();

  if (!CheckThatRaceHasStarted(thisFrame))
  {
    return {};
  }
  if (!CheckThatThisIsANewFrame(thisFrame))
  {
    return cached_inputs;
  }
  CheckForMissedFramesAndHandle(thisFrame);

  frame_at_last_input_request = thisFrame;

  if (!CheckThatAIIsAlive())
  {
    return {};
  }
  UpdateLapsAndRestoreCount();

  ///
  /// DO LEARNING
  ///

  ChunkCoordinates userChunk = CalculateUserChunk();

  LogToFileListener("> LOC P(%f;%f;%f) C(%i;%i;%i) %s", player_info_retriever.PlayerVehicleX(), player_info_retriever.PlayerVehicleY(),
                    player_info_retriever.PlayerVehicleZ(), userChunk.x, userChunk.y, userChunk.z,
                    player_info_retriever.GoingTheWrongWay() ? "WRONG" : "RIGHT");

  AdvantageUpdatingState* currentState = GetCurrentState(userChunk);

  float reward = NAN;
  float old_advantage = NAN;
  float new_advantage = NAN;
  float old_EOV = NAN;
  float new_EOV = NAN;
  if (did_q_learning_last_frame)
  {
    learning_occured_frame_count++;

    reward = CalculateReward();
    float deltaTSeconds = 1;// / 60.0f;

    float discounted_new_EOV = DISCOUNT_RATE * (currentState->expectedOptimalValue);
    old_EOV = previous_advantage_updating_state->expectedOptimalValue;
    float reference_advantage_before_update = previous_advantage_updating_state->advantages.BestScore();

    float base_new_advantage = reference_advantage_before_update + ((reward + discounted_new_EOV - old_EOV) / deltaTSeconds);
    old_advantage = previous_advantage_updating_state->advantages.ScoreForAction(previous_action);
    new_advantage = MoveValueTowards(ADVANTAGE_UPDATE_RATE, old_advantage, base_new_advantage);
    previous_advantage_updating_state->advantages.SetActionScore(previous_action, new_advantage);

    float reference_advantage_after_update = previous_advantage_updating_state->advantages.BestScore();
    float ref_diff = (reference_advantage_after_update - reference_advantage_before_update);

    float base_new_EOV = previous_advantage_updating_state->expectedOptimalValue + (ref_diff / ADVANTAGE_UPDATE_RATE);
    new_EOV = MoveValueTowards(EOV_UPDATE_RATE, old_EOV, base_new_EOV);
    previous_advantage_updating_state->expectedOptimalValue = new_EOV;

    LogToFileListener("> LEARN @%s(%i;%i;%i) A[%s] oA=%.10f nA=%.10f oV=%.10f nV=%.10f (ct=%i)", previous_going_wrong_way ? "W" : "R",
                      previous_chunk_coords.x, previous_chunk_coords.y, previous_chunk_coords.z,
                      ActionHelper::GetActionName(previous_action).c_str(), old_advantage, new_advantage, old_EOV, new_EOV,
                      learning_occured_frame_count);
  }
  else
  {
    generate_inputs_but_dont_learn_frame_count++;
    LogToFileListener("> NOLEARN (ct=%i)", generate_inputs_but_dont_learn_frame_count);
  }

  for (u32 i = 0; i < NORMALIZATIONS_PER_FRAME; i++)
  {
    u32 randIdx = std::uniform_int_distribution<u32>(0, (u32)(chunk_coord_to_chunk_map.size() - 1))(generator);
    auto pair = *std::next(std::begin(chunk_coord_to_chunk_map), randIdx);
    ChunkCoordinates chunkLoc = pair.first;
    Chunk* random_chunk = pair.second;

    bool wrong_way = std::bernoulli_distribution(0.5)(generator);
    AdvantageUpdatingState* random_state = &(wrong_way ? random_chunk->going_wrong_way_state : random_chunk->going_right_way_state);

    Action random_action = (Action)action_index_distribution(generator);
    float old_score = random_state->advantages.ScoreForAction(random_action);
    float base_new_score = old_score - random_state->advantages.BestScore();
    float newScore = MoveValueTowards(NORMALIZATION_RATE, old_score, base_new_score);
    random_state->advantages.SetActionScore(random_action, newScore);

    //LogToFileListener("> NORM @%s(%i;%i;%i) A[%s] o=%.10f n=%.10f (ct=%i)", wrong_way ? "W" : "R", chunkLoc.x, chunkLoc.y, chunkLoc.z,
    //                  ActionHelper::GetActionName(random_action).c_str(), old_score, newScore);
  }

  ScoredActions curStateAdvantages = currentState->advantages;

  bool action_chosen_randomly;
  Action action_to_take = ChooseAction(&curStateAdvantages, &action_chosen_randomly);

  LogToFileListener("> ACT %s [%s]", (action_chosen_randomly ? "RAND" : "BEST"), ActionHelper::GetActionName(action_to_take).c_str());

  ///
  /// FINAL LOGGING AND CLEANUP
  ///

  if (debug_info_enabled)
  {
    std::chrono::time_point calc_end_time = std::chrono::system_clock::now();

    AILog("============================================================");
    AILog("Frame Ct:                                %i", player_info_retriever.TotalFrames());
    AILog("Frame Ct total learning:                 %i", learning_occured_frame_count);
    AILog("Frames lost because can't access info:   %i", skip_learning_because_cant_access_info_frames_lost);
    AILog("Frame Ct skip learning because death:    %i", skip_learning_because_crashing_frame_count);
    AILog("Frame Ct gen inputs but don't learn:     %i", generate_inputs_but_dont_learn_frame_count);
    AILog("Restore count: %i", restore_count);
    AILog("Chunk count: %i", chunk_coord_to_chunk_map.size());
    AILog("State count: %i", chunk_coord_to_chunk_map.size() * 2);
    AILog("Pos:    (%4f, %4f, %4f)", player_info_retriever.PlayerVehicleX(), player_info_retriever.PlayerVehicleY(),
          player_info_retriever.PlayerVehicleZ());
    AILog("State:  (%3i, %3i, %3i) | %s way", userChunk.x, userChunk.y, userChunk.z,
          player_info_retriever.GoingTheWrongWay() ? "WRONG" : "RIGHT");
    AILog("Speed:  %7.2f", player_info_retriever.PlayerSpeed());
    AILog("EOV:    %7.2f", currentState->expectedOptimalValue);
    AILog("Scores: [%7.2f, %7.2f, %7.2f, %7.2f, %7.2f] (no boost)", curStateAdvantages.ScoreForAction(Action::SHARP_TURN_LEFT),
          curStateAdvantages.ScoreForAction(Action::SOFT_TURN_LEFT), curStateAdvantages.ScoreForAction(Action::FORWARD),
          curStateAdvantages.ScoreForAction(Action::SOFT_TURN_RIGHT), curStateAdvantages.ScoreForAction(Action::SHARP_TURN_RIGHT));
    AILog("        [%7.2f, %7.2f, %7.2f, %7.2f, %7.2f] (boost)", curStateAdvantages.ScoreForAction(Action::BOOST_AND_SHARP_TURN_LEFT),
          curStateAdvantages.ScoreForAction(Action::BOOST_AND_SOFT_TURN_LEFT), curStateAdvantages.ScoreForAction(Action::BOOST_AND_FORWARD),
          curStateAdvantages.ScoreForAction(Action::BOOST_AND_SOFT_TURN_RIGHT),
          curStateAdvantages.ScoreForAction(Action::BOOST_AND_SHARP_TURN_RIGHT));
    AILog("        [%7.2f,        ,        ,        , %7.2f] (drift)", curStateAdvantages.ScoreForAction(Action::DRIFT_AND_SHARP_TURN_LEFT),
          curStateAdvantages.ScoreForAction(Action::DRIFT_AND_SHARP_TURN_RIGHT));
    AILog("Action type:  %s", ACTION_NAMES.at(action_to_take).c_str());
    AILog("Way chosen:   %s", action_chosen_randomly ? "RANDOM" : "BEST");
    AILog("Explore rate: %f", CalculateExplorationRate());
    AILog("Action score: %f", curStateAdvantages.ScoreForAction(action_to_take));
    if (did_q_learning_last_frame)
    {
      if (reward == NAN || old_advantage == NAN || new_advantage == NAN || old_EOV == NAN || new_EOV == NAN)
      {
        PanicAlert("Score calculation not done even though it should have been!!!!");
      }

      AILog("Reward for prev action: %f", reward);
      AILog("Prev action old adv:  %f", old_advantage);
      AILog("Prev action new adv:  %f", new_advantage);
      AILog("Prev action old EOV:  %f", old_EOV);
      AILog("Prev action new EOV:  %f", new_EOV);
    }
    else
    {
      AILog("[");
      AILog("[ No learning done as AI was not");
      AILog("[ able to execute last frame. ");
      AILog("[");
    }

    std::ostringstream oss;
    oss << "Time to calculate: " << std::chrono::duration_cast<std::chrono::microseconds>(calc_end_time - calc_start_time).count()
        << " microseconds";
    AILog(oss.str().c_str());
  }

  if (thisFrame != (learning_occured_frame_count + skip_learning_because_crashing_frame_count +
                    skip_learning_because_cant_access_info_frames_lost + generate_inputs_but_dont_learn_frame_count))
  {
    PanicAlert("Frame counts have gotten off!!");
  }

  if (learning_occured_frame_count % (SECONDS_BETWEEN_STATE_SAVES * 60) == 0)
  {
    AILog("Saved full state to log");
    SaveStateToLog();
  }

  did_q_learning_last_frame = true;
  prevPlayerSpeed = player_info_retriever.PlayerSpeed();
  previous_advantage_updating_state = currentState;
  previous_going_wrong_way = player_info_retriever.GoingTheWrongWay();
  previous_chunk_coords = userChunk;
  previous_action = action_to_take;

  GCPadStatus inputs = ActionHelper::GenerateInputsFromAction(action_to_take);
  cached_inputs = inputs;
  return inputs;
}

AI::~AI()
{
}
